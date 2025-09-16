/**
 * Dedicated Screenshare Capture Service
 * Manages persistent screen sharing streams and provides efficient frame capture
 */

const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

class ScreenshareCapture {
  constructor() {
    this.isInitialized = false;
    this.stream = null;
    this.captureWorker = null;
    this.isCapturing = false;
    this.lastFrameTime = 0;
    this.frameInterval = 100; // Minimum time between captures in ms
    this.isWayland = process.env.XDG_SESSION_TYPE === 'wayland';
    this.isLinux = os.platform() === 'linux';
    this.isWindows = os.platform() === 'win32';
    
    // Performance monitoring
    this.captureStats = {
      totalCaptures: 0,
      failedCaptures: 0,
      averageCaptureTime: 0,
      lastCaptureTime: 0
    };
    
    console.log('ScreenshareCapture service initialized');
  }

  /**
   * Initialize the screenshare capture service
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('Screenshare capture already initialized');
      return;
    }

    try {
      console.log('Initializing screenshare capture service...');
      
      // Get the main window for communication
      const { BrowserWindow } = require('electron');
      this.mainWindow = BrowserWindow.getAllWindows().find(win => 
        win.webContents.getURL().includes('index.html') || 
        win.getTitle().includes('DBD Map Overlay')
      );

      if (!this.mainWindow) {
        throw new Error('Main window not found for screenshare initialization');
      }

      // Initialize the screen share in the renderer
      await this.initializeRendererScreenshare();
      
      // Set up the capture worker for better performance
      if (this.isLinux && !this.isWayland) {
        // On X11, we can use a worker thread for better performance
        this.setupCaptureWorker();
      }
      
      this.isInitialized = true;
      console.log('Screenshare capture service initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize screenshare capture:', error);
      throw error;
    }
  }

  /**
   * Initialize screenshare in the renderer process
   */
  async initializeRendererScreenshare() {
    console.log('Requesting screenshare from renderer...');
    
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const result = await this.mainWindow.webContents.executeJavaScript(`
          (async () => {
            // Wait for screenShareRenderer to be available
            if (typeof window.screenShareRenderer === 'undefined') {
              return { success: false, error: 'Screen share renderer not loaded yet' };
            }
            
            try {
              const stream = await window.screenShareRenderer.requestScreenShare();
              const status = window.screenShareRenderer.getStatus();
              return { success: true, status };
            } catch (error) {
              return { success: false, error: error.message };
            }
          })()
        `);

        if (result.success) {
          console.log('Screenshare initialized in renderer:', result.status);
          return;
        } else {
          console.log(`Attempt ${attempts}/${maxAttempts} failed:`, result.error);
          
          // If renderer not ready, wait and try again
          if (result.error.includes('not loaded yet')) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          } else {
            throw new Error(result.error);
          }
        }
      } catch (error) {
        console.error(`Renderer screenshare attempt ${attempts} failed:`, error.message);
        
        if (attempts === maxAttempts) {
          throw error;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    throw new Error(`Failed to initialize renderer screenshare after ${maxAttempts} attempts`);
  }

  /**
   * Set up a worker thread for high-performance capture (X11 only)
   */
  setupCaptureWorker() {
    if (this.isWayland || !this.isLinux) {
      return; // Workers only beneficial on X11
    }

    try {
      const workerPath = path.join(__dirname, 'captureWorker.js');
      
      // Only create worker if the file exists
      const fs = require('fs');
      if (fs.existsSync(workerPath)) {
        this.captureWorker = new Worker(workerPath);
        
        this.captureWorker.on('error', (error) => {
          console.warn('Capture worker error:', error.message);
          this.captureWorker = null;
        });
        
        console.log('Capture worker thread initialized');
      }
    } catch (error) {
      console.warn('Failed to setup capture worker:', error.message);
      this.captureWorker = null;
    }
  }

  /**
   * Capture a frame from the screenshare stream
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async captureFrame() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Rate limiting
    const now = Date.now();
    if (now - this.lastFrameTime < this.frameInterval) {
      await new Promise(resolve => 
        setTimeout(resolve, this.frameInterval - (now - this.lastFrameTime))
      );
    }

    const startTime = Date.now();
    
    try {
      this.isCapturing = true;
      
      const result = await this.mainWindow.webContents.executeJavaScript(`
        (async () => {
          try {
            const imageData = await window.screenShareRenderer.captureFrame();
            const status = window.screenShareRenderer.getStatus();
            return { success: true, imageData, status };
          } catch (error) {
            return { success: false, error: error.message };
          }
        })()
      `);

      if (!result.success) {
        throw new Error(`Frame capture failed: ${result.error}`);
      }

      // Convert base64 to buffer
      const base64Data = result.imageData.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Update stats
      const captureTime = Date.now() - startTime;
      this.updateCaptureStats(captureTime, true);
      this.lastFrameTime = Date.now();
      
      return buffer;
      
    } catch (error) {
      this.updateCaptureStats(Date.now() - startTime, false);
      console.error('Screenshare frame capture failed:', error);
      
      // Try to reinitialize on certain errors
      if (error.message.includes('not initialized') || 
          error.message.includes('Video not ready')) {
        console.log('Reinitializing screenshare due to error...');
        this.isInitialized = false;
        await this.initialize();
        throw error; // Re-throw to trigger retry at higher level
      }
      
      throw error;
    } finally {
      this.isCapturing = false;
    }
  }

  /**
   * Update capture performance statistics
   */
  updateCaptureStats(captureTime, success) {
    this.captureStats.totalCaptures++;
    this.captureStats.lastCaptureTime = captureTime;
    
    if (success) {
      // Update rolling average
      const alpha = 0.1; // Smoothing factor
      this.captureStats.averageCaptureTime = 
        (1 - alpha) * this.captureStats.averageCaptureTime + alpha * captureTime;
    } else {
      this.captureStats.failedCaptures++;
    }
  }

  /**
   * Get capture performance statistics
   */
  getStats() {
    const successRate = this.captureStats.totalCaptures > 0 ? 
      ((this.captureStats.totalCaptures - this.captureStats.failedCaptures) / this.captureStats.totalCaptures * 100).toFixed(1) : 0;
    
    return {
      ...this.captureStats,
      successRate: `${successRate}%`,
      isCapturing: this.isCapturing,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Get the current status of the screenshare
   */
  async getStatus() {
    if (!this.isInitialized || !this.mainWindow) {
      return {
        initialized: this.isInitialized,
        available: false,
        error: 'Not initialized'
      };
    }

    try {
      const result = await this.mainWindow.webContents.executeJavaScript(`
        window.screenShareRenderer ? window.screenShareRenderer.getStatus() : { error: 'Renderer not available' }
      `);

      return {
        initialized: this.isInitialized,
        available: true,
        renderer: result,
        stats: this.getStats()
      };
    } catch (error) {
      return {
        initialized: this.isInitialized,
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Stop screenshare and cleanup resources
   */
  async stop() {
    console.log('Stopping screenshare capture service...');
    
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        await this.mainWindow.webContents.executeJavaScript(`
          if (window.screenShareRenderer) {
            window.screenShareRenderer.stopScreenShare();
          }
        `);
      }
    } catch (error) {
      console.warn('Error stopping renderer screenshare:', error.message);
    }

    if (this.captureWorker) {
      await this.captureWorker.terminate();
      this.captureWorker = null;
    }

    this.isInitialized = false;
    this.isCapturing = false;
    this.mainWindow = null;
    
    // Reset stats
    this.captureStats = {
      totalCaptures: 0,
      failedCaptures: 0,
      averageCaptureTime: 0,
      lastCaptureTime: 0
    };
    
    console.log('Screenshare capture service stopped');
  }

  /**
   * Set the frame capture rate
   * @param {number} fps - Desired frames per second (1-30)
   */
  setFrameRate(fps) {
    fps = Math.max(1, Math.min(30, fps)); // Clamp between 1-30 FPS
    this.frameInterval = 1000 / fps;
    console.log(`Frame rate set to ${fps} FPS (interval: ${this.frameInterval}ms)`);
  }
}

module.exports = ScreenshareCapture;
