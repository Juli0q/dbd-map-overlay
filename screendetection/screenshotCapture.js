const { desktopCapturer, ipcMain } = require('electron');
const { Jimp } = require('jimp');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

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
    this.streamingSource = null;
    this.streamInterval = null;
    this.frameCallback = null;
    
    // Screenshot backend configuration
    this.screenshotBackend = screenshotBackend;
    this.availableBackends = this.getAvailableBackends();
    this.selectedBackend = this.determineBackend();
    
    console.log(`Screenshot backend: ${this.selectedBackend}`);
  }

  getAvailableBackends() {
    const backends = {
      'auto': 'Auto-detect based on desktop environment',
      'electron': 'Electron desktopCapturer (X11/Windows only)',
      'screenshare': 'Electron Screen Share Stream',
      'spectacle': 'KDE Spectacle',
      'gnome-screenshot': 'GNOME Screenshot',
      'import': 'ImageMagick import',
      'scrot': 'Scrot',
      'maim': 'Maim',
      'flameshot': 'Flameshot',
      'xfce4-screenshooter': 'XFCE4 Screenshooter'
    };

    if (this.isWindows) {
      return { 
        'electron': backends['electron'],
        'screenshare': backends['screenshare']
      };
    }

    return backends;
  }

  async listCaptureSources() {
    const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 384, height: 216 }, // Smaller thumbnails for preview
        fetchWindowIcons: true
    });

    return sources.map(source => ({
        id: source.id,
        name: source.name,
        type: source.display_id ? 'screen' : 'window',
        thumbnail: source.thumbnail.toDataURL(),
        icon: source.appIcon?.toDataURL()
    }));
  }

  async selectSource(sourceId) {
    if (this.streamingSource) {
        this.stopScreenShare();
    }

    const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 3840, height: 2160 }
    });

    const selectedSource = sources.find(s => s.id === sourceId);
    if (!selectedSource) {
        throw new Error('Selected source not found');
    }

    this.streamingSource = selectedSource;
    console.log(`Selected capture source: ${selectedSource.name}`);
    
    return this.streamingSource;
  }

  async startScreenShare(sourceId = null, fps = 1) {
    if (this.streamingSource) {
        this.stopScreenShare();
    }

    // Initial source setup - only request permissions once
    const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1280, height: 720 }
    });

    if (sources.length === 0) {
        throw new Error('No sources available');
    }

    const selectedSource = sourceId ? 
        sources.find(s => s.id === sourceId) :
        sources[0];

    if (!selectedSource) {
        throw new Error('Selected source not found');
    }

    // Store source ID for refreshing
    this.streamingSourceId = selectedSource.id;
    this.streamingSource = selectedSource;
    console.log(`Screen share started for: ${this.streamingSource.name}`);

    const capture = async () => {
        if (!this.streamInterval) return;

        try {
            // Only refresh the thumbnail of existing source
            const buffer = await this.cropWithJimp(this.streamingSource.thumbnail.toPNG());
            
            if (this.frameCallback) {
                this.frameCallback(buffer);
            }
        } catch (error) {
            // If thumbnail is stale, refresh the source without showing permission dialog
            try {
                const newSources = await desktopCapturer.getSources({
                    types: ['screen', 'window'],
                    thumbnailSize: { width: 1280, height: 720 }
                });
                this.streamingSource = newSources.find(s => s.id === this.streamingSourceId) || this.streamingSource;
            } catch (refreshError) {
                console.error('Failed to refresh source:', refreshError);
            }
        }

        // Schedule next capture
        if (this.streamInterval) {
            setTimeout(capture, 1000 / fps);
        }
    };

    this.streamInterval = true;
    capture();
  }

  stopScreenShare() {
      this.streamInterval = false;  // Stop the animation frame loop
      this.streamingSource = null;
      console.log('Screen share stopped');
  }

  onFrame(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    this.frameCallback = callback;
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
      return 'electron';
    }
    
    if (!this.isLinux) {
      return 'electron';
    }

    // For X11, prefer electron if available
    if (!this.isWayland) {
      return 'electron';
    }

    // For Wayland, detect desktop environment and choose appropriate tool
    const de = this.detectDesktopEnvironment();
    
    const deBackends = {
      'kde': 'spectacle',
      'gnome': 'gnome-screenshot',
      'xfce': 'xfce4-screenshooter',
      'lxde': 'scrot',
      'mate': 'mate-screenshot',
      'cinnamon': 'gnome-screenshot',
      'budgie': 'gnome-screenshot',
      'i3': 'scrot'
    };

    return deBackends[de] || 'spectacle'; // Default fallback
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

  async captureBottomLeft(sourceId = null) {
    try {
        let buffer;
        
        if (this.selectedBackend === 'screenshare') {
            // Get a fresh capture for screenshare
            const sources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: { width: 1280, height: 720 }
            });

            const source = sourceId ? 
                sources.find(s => s.id === sourceId) : 
                sources[0];

            if (!source) {
                throw new Error('Source not found');
            }

            buffer = source.thumbnail.toPNG();
        } else if (this.selectedBackend === 'electron') {
            buffer = sourceId ? 
                await this.captureWithElectron(sourceId) :
                await this.captureWithElectron();
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
    return {
      platform: os.platform(),
      isWayland: this.isWayland,
      detectedDE: detectedDE,
      selectedBackend: this.selectedBackend,
      availableBackends: this.availableBackends
    };
  }

  // Change screenshot backend
  setBackend(backend) {
    if (!this.availableBackends[backend]) {
      throw new Error(`Backend '${backend}' is not available. Available backends: ${Object.keys(this.availableBackends).join(', ')}`);
    }
    
    if (this.streamingSource && backend !== 'screenshare') {
      this.stopScreenShare();
    }
    
    this.screenshotBackend = backend;
    this.selectedBackend = this.determineBackend();
    console.log(`Screenshot backend changed to: ${this.selectedBackend}`);
  }
}

module.exports = ScreenCapture;