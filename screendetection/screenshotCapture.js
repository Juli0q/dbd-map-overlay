// screenshotCapture.js
const { desktopCapturer } = require('electron');
const { Jimp } = require('jimp');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const ScreenshareCapture = require('./screenshareCapture');

const execAsync = promisify(exec);

class ScreenCapture {
  constructor(screenshotBackend = 'auto') {
    this.isCapturing = false;
    this.cachedSources = null;
    this.lastSourcesTime = 0;
    this.sourceCacheTimeout = 30000; // Cache for 30 seconds
    this.isWayland = process.env.XDG_SESSION_TYPE === 'wayland';
    this.isLinux = os.platform() === 'linux';
    this.isWindows = os.platform() === 'win32';
    
    // Screenshot backend configuration
    this.screenshotBackend = screenshotBackend;
    this.availableBackends = this.getAvailableBackends();
    this.selectedBackend = this.determineBackend();
    
    // Initialize screenshare service for electron-screenshare backend
    if (this.selectedBackend === 'electron-screenshare') {
      this.screenshareService = new ScreenshareCapture();
    }
    
    console.log(`Screenshot backend: ${this.selectedBackend}`);
  }

  getAvailableBackends() {
    const backends = {
      'auto': 'Auto-detect based on desktop environment',
      'electron': 'Electron desktopCapturer (X11/Windows only)',
      'electron-screenshare': 'Electron Screen Share API (All platforms)',
      'spectacle': 'KDE Spectacle',
      'gnome-screenshot': 'GNOME Screenshot',
      'import': 'ImageMagick import',
      'scrot': 'Scrot',
      'maim': 'Maim',
      'flameshot': 'Flameshot',
      'xfce4-screenshooter': 'XFCE4 Screenshooter'
    };

    if (this.isWindows) {
      // On Windows, both electron and electron-screenshare work
      return { 
        'electron': backends['electron'],
        'electron-screenshare': backends['electron-screenshare']
      };
    }

    return backends;
  }

  detectDesktopEnvironment() {
    const env = process.env;
    
    // Check various environment variables to detect DE
    if (env.KDE_FULL_SESSION || env.KDE_SESSION_VERSION || env.DESKTOP_SESSION?.includes('kde')) {
      return 'kde';
    }
    
    if (env.GNOME_DESKTOP_SESSION_ID || env.DESKTOP_SESSION?.includes('gnome') || env.XDG_CURRENT_DESKTOP?.includes('GNOME')) {
      return 'gnome';
    }
    
    if (env.DESKTOP_SESSION?.includes('xfce') || env.XDG_CURRENT_DESKTOP?.includes('XFCE')) {
      return 'xfce';
    }
    
    if (env.DESKTOP_SESSION?.includes('lxde') || env.XDG_CURRENT_DESKTOP?.includes('LXDE')) {
      return 'lxde';
    }
    
    if (env.DESKTOP_SESSION?.includes('mate') || env.XDG_CURRENT_DESKTOP?.includes('MATE')) {
      return 'mate';
    }
    
    if (env.DESKTOP_SESSION?.includes('cinnamon') || env.XDG_CURRENT_DESKTOP?.includes('X-Cinnamon')) {
      return 'cinnamon';
    }
    
    if (env.DESKTOP_SESSION?.includes('budgie') || env.XDG_CURRENT_DESKTOP?.includes('Budgie')) {
      return 'budgie';
    }
    
    if (env.DESKTOP_SESSION?.includes('i3') || env.XDG_CURRENT_DESKTOP?.includes('i3')) {
      return 'i3';
    }
    
    return 'unknown';
  }

  determineBackend() {
    if (this.screenshotBackend !== 'auto') {
      return this.screenshotBackend;
    }

    // Auto-detection logic
    if (this.isWindows) {
      // On Windows, prefer electron-screenshare for consistent permissions
      return 'electron-screenshare';
    }
    
    if (!this.isLinux) {
      return 'electron-screenshare';
    }

    // For Wayland, always use electron-screenshare for single permission popup
    if (this.isWayland) {
      return 'electron-screenshare';
    }

    // For X11, prefer electron for performance, but electron-screenshare is also available
    return 'electron';
  }

  getScreenshotCommand(backend, tempFile) {
    const commands = {
      'spectacle': `spectacle -m -b -n -o "${tempFile}"`,
      'gnome-screenshot': `gnome-screenshot -f "${tempFile}"`,
      'import': `import -window root "${tempFile}"`,
      'scrot': `scrot "${tempFile}"`,
      'maim': `maim "${tempFile}"`,
      'flameshot': `flameshot full -p "${path.dirname(tempFile)}" -f "${path.basename(tempFile).replace('.png', '')}"`,
      'xfce4-screenshooter': `xfce4-screenshooter -f -s "${tempFile}"`,
      'mate-screenshot': `mate-screenshot -f "${tempFile}"`
    };

    return commands[backend];
  }

  async captureBottomLeft(displayId = 0) {
    try {
      let buffer;
      
      if (this.selectedBackend === 'electron') {
        buffer = await this.captureWithElectron(displayId);
      } else if (this.selectedBackend === 'electron-screenshare') {
        try {
          buffer = await this.captureWithScreenshare();
        } catch (screenshareError) {
          console.warn('Screenshare capture failed, falling back to electron method:', screenshareError.message);
          
          // Fallback to electron capture if screenshare fails
          if (!this.isWayland) {
            console.log('Falling back to electron desktopCapturer method');
            buffer = await this.captureWithElectron(displayId);
          } else {
            // On Wayland, try native tools as fallback
            console.log('Falling back to native screenshot tools');
            buffer = await this.captureWithNativeTools();
          }
        }
      } else {
        buffer = await this.captureWithNativeTools();
      }
      
      console.log('Screenshot captured successfully');
      return await this.cropWithJimp(buffer);
    } catch (error) {
      console.error('Desktop capture failed:', error);
      throw error;
    }
  }

  async captureWithElectron(displayId = 0) {
    if (this.isWayland) {
      throw new Error('Electron desktopCapturer is not supported on Wayland');
    }

    const now = Date.now();
    
    // Use cached sources if available and recent
    if (this.cachedSources && (now - this.lastSourcesTime) < this.sourceCacheTimeout) {
      console.log('Using cached screen sources');
    } else {
      console.log('Fetching new screen sources...');
      this.cachedSources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 3840, height: 2160 }
      });
      this.lastSourcesTime = now;
    }

    if (this.cachedSources.length === 0) {
      throw new Error('No screen sources available');
    }

    const source = this.cachedSources[displayId] || this.cachedSources[0];
    const screenshot = source.thumbnail;
    
    console.log(`Using screenshot from display: ${source.name}`);
    return screenshot.toPNG();
  }

  async captureWithNativeTools() {
    const tempFile = path.join(os.tmpdir(), `screenshot_${Date.now()}.png`);
    
    try {
      const command = this.getScreenshotCommand(this.selectedBackend, tempFile);
      
      if (!command) {
        throw new Error(`Unsupported screenshot backend: ${this.selectedBackend}`);
      }

      console.log(`Using screenshot backend: ${this.selectedBackend}`);
      console.log(`Executing: ${command}`);
      
      await execAsync(command);
      
      // Check if file was created
      const stats = await fs.stat(tempFile);
      if (stats.size === 0) {
        throw new Error('Screenshot file is empty');
      }

      // Read the screenshot file
      const buffer = await fs.readFile(tempFile);
      
      // Clean up temp file
      try {
        await fs.unlink(tempFile);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp file:', cleanupError.message);
      }

      return buffer;
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempFile);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  async cropWithJimp(buffer) {
    const image = await Jimp.read(buffer);
    
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    console.log(`Image dimensions: ${width}x${height}`);

    // DBD map name region
    const cropOptions = {
      x: 0,
      y: Math.floor(height * 0.80),
      w: width,
      h: Math.floor(height * 0.15)
    };

    console.log(`Crop region:`, cropOptions);

    // Crop and enhance
    const croppedImage = image
      .crop(cropOptions)
      .contrast(0.3)
      .normalize()
      .greyscale();

    return await croppedImage.getBuffer('image/png');
  }

  async captureWithScreenshare() {
    if (!this.screenshareService) {
      this.screenshareService = new ScreenshareCapture();
    }

    try {
      const buffer = await this.screenshareService.captureFrame();
      return buffer;
    } catch (error) {
      console.error('Screenshare capture failed:', error);
      throw error;
    }
  }

  async captureAndSave(outputPath) {
    const buffer = await this.captureBottomLeft();
    await fs.writeFile(outputPath, buffer);
    console.log(`Screenshot saved to: ${outputPath}`);
    return outputPath;
  }

  // Clear cached sources (useful for testing or manual refresh)
  clearCache() {
    this.cachedSources = null;
    this.lastSourcesTime = 0;
    console.log('Screenshot source cache cleared');
  }

  // Get current screenshot method info
  getScreenshotInfo() {
    const detectedDE = this.detectDesktopEnvironment();
    const info = {
      platform: os.platform(),
      isWayland: this.isWayland,
      detectedDE: detectedDE,
      selectedBackend: this.selectedBackend,
      availableBackends: this.availableBackends
    };

    // Add screenshare service info if available
    if (this.screenshareService) {
      info.screenshareStatus = 'Service initialized';
    }

    return info;
  }

  // Change screenshot backend
  setBackend(backend) {
    if (!this.availableBackends[backend]) {
      throw new Error(`Backend '${backend}' is not available. Available backends: ${Object.keys(this.availableBackends).join(', ')}`);
    }
    
    // Cleanup existing screenshare service if switching backends
    if (this.screenshareService && backend !== 'electron-screenshare') {
      this.screenshareService.stop().catch(err => 
        console.warn('Error stopping screenshare service:', err.message)
      );
      this.screenshareService = null;
    }
    
    this.screenshotBackend = backend;
    this.selectedBackend = this.determineBackend();
    
    // Initialize new screenshare service if needed
    if (this.selectedBackend === 'electron-screenshare' && !this.screenshareService) {
      this.screenshareService = new ScreenshareCapture();
    }
    
    console.log(`Screenshot backend changed to: ${this.selectedBackend}`);
  }

  // Get screenshare service status
  async getScreenshareStatus() {
    if (!this.screenshareService) {
      return { available: false, error: 'Screenshare service not initialized' };
    }

    try {
      return await this.screenshareService.getStatus();
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  // Stop screenshare service
  async stopScreenshare() {
    if (this.screenshareService) {
      try {
        await this.screenshareService.stop();
        console.log('Screenshare service stopped');
      } catch (error) {
        console.error('Error stopping screenshare service:', error);
      }
    }
  }

  // Cleanup all resources
  async cleanup() {
    await this.stopScreenshare();
    this.screenshareService = null;
    this.clearCache();
    console.log('ScreenCapture cleanup completed');
  }
}

module.exports = ScreenCapture;