/**
 * Screen Share Renderer - Handles screen sharing in the renderer process
 * This module manages the screen share stream and provides frame capture capabilities
 */

class ScreenShareRenderer {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.context = null;
    this.isInitialized = false;
    this.isWayland = navigator.userAgent.includes('X11') === false && 
                     navigator.userAgent.includes('Wayland') === true;
    
    // Check API availability
    this.checkApiAvailability();
    
    console.log('ScreenShareRenderer initialized');
  }

  /**
   * Check if required APIs are available
   */
  checkApiAvailability() {
    const availability = {
      navigator: typeof navigator !== 'undefined',
      mediaDevices: typeof navigator?.mediaDevices !== 'undefined',
      getDisplayMedia: typeof navigator?.mediaDevices?.getDisplayMedia !== 'undefined',
      getUserMedia: typeof navigator?.mediaDevices?.getUserMedia !== 'undefined',
      webkitGetDisplayMedia: typeof navigator?.webkitGetDisplayMedia !== 'undefined'
    };
    
    console.log('API Availability Check:', availability);
    
    if (!availability.getDisplayMedia && !availability.webkitGetDisplayMedia) {
      console.warn('getDisplayMedia API not available. Screen sharing may not work.');
      console.log('User Agent:', navigator.userAgent);
      console.log('Electron version check needed');
    }
  }

  /**
   * Request screen share access from the user
   * On Wayland, this shows the permission popup only once
   * On X11/Windows, this may show source selection
   */
  async requestScreenShare() {
    if (this.stream) {
      console.log('Screen share already active');
      return this.stream;
    }

    try {
      console.log('Requesting screen share permission...');
      
      // Configure display media constraints
      const constraints = {
        video: {
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
          frameRate: { ideal: 10, max: 30 } // Lower frameRate for better compatibility
        },
        audio: false // We don't need audio for screenshot capture
      };
      
      // Check if getDisplayMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        // Try webkit prefixed version
        if (navigator.webkitGetDisplayMedia) {
          console.log('Using webkit prefixed getDisplayMedia');
          this.stream = await navigator.webkitGetDisplayMedia(constraints);
        } else {
          throw new Error('getDisplayMedia not supported in this Electron configuration. Please check webSecurity and contextIsolation settings.');
        }
      } else {
        console.log('Calling getDisplayMedia with constraints:', constraints);
        // Request the screen share
        this.stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      }

      console.log('Screen share permission granted, stream obtained');
      console.log('Stream details:', {
        id: this.stream.id,
        active: this.stream.active,
        tracks: this.stream.getTracks().length
      });
      
      // Set up video element for frame capture
      await this.setupVideoCapture();
      
      // Listen for stream end
      const videoTrack = this.stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          console.log('Screen share ended by user');
          this.cleanup();
        });
        
        console.log('Video track settings:', videoTrack.getSettings());
      }

      this.isInitialized = true;
      return this.stream;
      
    } catch (error) {
      console.error('Failed to get screen share:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      if (error.name === 'NotAllowedError') {
        throw new Error('Screen share permission denied by user');
      } else if (error.name === 'NotFoundError') {
        throw new Error('No screen share source available');
      } else if (error.name === 'AbortError') {
        throw new Error('Screen share request was cancelled');
      } else if (error.name === 'NotSupportedError') {
        throw new Error('Screen sharing not supported. Please check Electron webSecurity settings.');
      } else {
        throw new Error(`Screen share failed: ${error.message}`);
      }
    }
  }

  /**
   * Set up video element and canvas for frame capture
   */
  async setupVideoCapture() {
    // Create hidden video element
    this.video = document.createElement('video');
    this.video.style.display = 'none';
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    
    // Create canvas for frame capture
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
    
    // Set stream to video element
    this.video.srcObject = this.stream;
    
    // Wait for video to be ready
    return new Promise((resolve, reject) => {
      this.video.addEventListener('loadedmetadata', () => {
        // Set canvas size to match video
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        
        console.log(`Video capture setup: ${this.canvas.width}x${this.canvas.height}`);
        resolve();
      });
      
      this.video.addEventListener('error', (error) => {
        console.error('Video setup error:', error);
        reject(new Error('Failed to setup video capture'));
      });
      
      // Start playing
      this.video.play().catch(reject);
    });
  }

  /**
   * Capture a frame from the screen share stream
   * @returns {Promise<string>} Base64 encoded PNG image data
   */
  async captureFrame() {
    if (!this.isInitialized || !this.video || !this.canvas) {
      throw new Error('Screen share not initialized');
    }

    if (this.video.readyState !== this.video.HAVE_ENOUGH_DATA) {
      throw new Error('Video not ready for capture');
    }

    try {
      // Draw current video frame to canvas
      this.context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      
      // Convert canvas to base64 PNG
      const imageData = this.canvas.toDataURL('image/png');
      
      return imageData;
      
    } catch (error) {
      console.error('Frame capture failed:', error);
      throw new Error(`Frame capture failed: ${error.message}`);
    }
  }

  /**
   * Get the current screen share stream status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      hasStream: !!this.stream,
      streamActive: this.stream ? this.stream.active : false,
      videoReady: this.video ? this.video.readyState === this.video.HAVE_ENOUGH_DATA : false,
      dimensions: this.canvas ? { width: this.canvas.width, height: this.canvas.height } : null
    };
  }

  /**
   * Stop screen sharing and clean up resources
   */
  stopScreenShare() {
    console.log('Stopping screen share...');
    this.cleanup();
  }

  /**
   * Clean up all resources
   */
  cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        track.stop();
      });
      this.stream = null;
    }

    if (this.video) {
      this.video.srcObject = null;
      if (this.video.parentNode) {
        this.video.parentNode.removeChild(this.video);
      }
      this.video = null;
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.context = null;
    
    this.isInitialized = false;
    console.log('Screen share cleanup completed');
  }
}

// Make ScreenShareRenderer globally available
window.screenShareRenderer = new ScreenShareRenderer();

console.log('Screen Share Renderer loaded and ready');
