const { app, BrowserWindow, ipcMain } = require('electron');
const ScreenCapture = require('./screenshotCapture');
const OCRProcessor = require('./ocrProcessor');
const MapTranslator = require('./mapTranslator');
const ProcessMonitor = require('./processMonitor');
const fs = require('fs');
const path = require('path');
const { finished } = require('stream');

class MapDetectionService {
  constructor(settingsManager) {
    if (!settingsManager) {
      throw new Error('SettingsManager is required for MapDetectionService');
    }
    
    this.settings = settingsManager; // Use the injected settings manager
    this.screenCapture = new ScreenCapture();
    this.ocrProcessor = new OCRProcessor();
    this.mapTranslator = new MapTranslator(this.settings);
    this.processMonitor = new ProcessMonitor();
    this.isDetecting = false;
    this.detectionInterval = null;
    this.lastDetectedMap = null; // Track last detected map to avoid repeated displays
    
    this.setupIpcHandlers();
  }

  setupIpcHandlers() {
    // Screenshot backend management
    ipcMain.handle('get-screenshot-info', () => {
      return this.screenCapture.getScreenshotInfo();
    });

    ipcMain.handle('set-screenshot-backend', async (event, backend) => {
      try {
        this.screenCapture.setBackend(backend);
        return { success: true };
      } catch (error) {
        console.error('Failed to set screenshot backend:', error);
        throw error;
      }
    });

    // Process monitoring handlers
    ipcMain.handle('check-process', async (event, processPattern) => {
      try {
        const isRunning = await this.processMonitor.isProcessRunning(processPattern);
        return { success: true, isRunning };
      } catch (error) {
        console.error('Failed to check process:', error);
        return { success: false, error: error.message, isRunning: false };
      }
    });

    ipcMain.handle('get-running-processes', async (event) => {
      try {
        const processes = await this.processMonitor.getRunningProcesses();
        return { success: true, processes };
      } catch (error) {
        console.error('Failed to get running processes:', error);
        return { success: false, error: error.message, processes: [] };
      }
    });

    // Debug handler for process detection
    ipcMain.handle('debug-process-search', async (event, processPattern) => {
      try {
        const debugInfo = await this.processMonitor.debugProcessSearch(processPattern);
        return { success: true, debugInfo };
      } catch (error) {
        console.error('Failed to debug process search:', error);
        return { success: false, error: error.message };
      }
    });

    // Map detection handlers
    ipcMain.handle('detect-map', async (event, language) => {
      return await this.detectMap(language);
    });

    ipcMain.handle('start-detection', async (event, interval, language) => {
      this.startContinuousDetection(interval, language);
      return { success: true };
    });

    ipcMain.handle('stop-detection', async (event) => {
      this.stopContinuousDetection();
      return { success: true };
    });

    ipcMain.handle('save-test-image', async (event) => {
      try {
        const imageBuffer = await this.screenCapture.captureBottomLeft();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `test-screenshot-${timestamp}.png`;
        const filepath = path.join(app.getPath('userData'), 'test-screenshots', filename);
        
        // Ensure directory exists
        await fs.promises.mkdir(path.dirname(filepath), { recursive: true });
        
        // Save the image
        await fs.promises.writeFile(filepath, imageBuffer);
        
        console.log(`Test image saved: ${filepath}`);
        return { success: true, path: filepath };
      } catch (error) {
        console.error('Failed to save test image:', error);
        return { success: false, error: error.message };
      }
    });
  }

  async initialize() {
    await this.ocrProcessor.initialize();
    
    // Load detection language from settings
    const detectionLanguage = this.settings.getSetting('detectionLanguage', 'en');
    
    // Set screenshot backend from settings
    const screenshotBackend = this.settings.getSetting('screenshotBackend', 'auto');
    try {
      this.screenCapture.setBackend(screenshotBackend);
      console.log(`Screenshot backend initialized: ${screenshotBackend}`);
    } catch (error) {
      console.warn('Failed to set screenshot backend from settings:', error);
    }
    
    // Load translation files
    await this.mapTranslator.loadLanguage('en'); // Always load English as fallback
    
    if (detectionLanguage !== 'en') {
      try {
        await this.mapTranslator.loadLanguage(detectionLanguage);
        console.log(`Loaded translations for: ${detectionLanguage}`);
      } catch (error) {
        console.warn(`Failed to load translations for ${detectionLanguage}, falling back to English`);
      }
    }

    console.log('Map detection service initialized');
  }

  /**
   * Check if the target process is running based on settings
   * @returns {Promise<boolean>}
   */
  async isTargetProcessRunning() {
    const processCheckEnabled = this.settings.getSetting('processCheckEnabled', false);
    
    if (!processCheckEnabled) {
      return true; // If process checking is disabled, always allow detection
    }

    const processPattern = this.settings.getSetting('processPattern', 'DeadByDaylight');
    try {
      const isRunning = await this.processMonitor.isProcessRunning(processPattern);
      
      // Log for debugging
      if (process.env.DEBUG_PROCESS) {
        console.log(`Process check: pattern="${processPattern}", running=${isRunning}`);
      }
      
      return isRunning;
    } catch (error) {
      console.error('Error checking target process:', error);
      // If there's an error checking processes, assume it's running to avoid blocking detection
      return true;
    }
  }

  /**
   * Trigger automatic map display
   * @param {string} mapKey - The detected map key
   */
  async triggerMapDisplay(mapKey) {
    try {

      this.lastDetectedMap = mapKey;
      console.log(`Auto-displaying map: ${mapKey}`);
      
      // Send the show-map-command event to the renderer process
      // This mimics how hotkeys and command line work in images.js
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send('show-map-by-key', mapKey);
      }
      
    } catch (error) {
      console.error('Failed to trigger map display:', error);
    }
  }

  /**
   * Reset the last detected map (useful when stopping detection)
   */
  resetLastDetectedMap() {
    this.lastDetectedMap = null;
  }

  async detectMap(language = null) {
    try {
      // Check if target process is running (if enabled)
      const isProcessRunning = await this.isTargetProcessRunning();
      if (!isProcessRunning) {
        // Reset last detected map when process is not running
        this.resetLastDetectedMap();
        return {
          success: true,
          gameFinished: false,
          detectedText: '',
          mapKey: null,
          confidence: 0.0,
          thresholdMet: false,
          processNotRunning: true
        };
      }

      // Get detection parameters from settings
      const detectionLanguage = language || this.settings.getSetting('detectionLanguage', 'en');
      const confidence = parseFloat(this.settings.getSetting('detectionConfidence', '0.7'));

      console.log(`Detecting map with language: ${detectionLanguage}, confidence threshold: ${confidence}`);
      
      // Ensure language is loaded
      if (!this.mapTranslator.loadedLanguages.has(detectionLanguage)) {
        await this.mapTranslator.loadLanguage(detectionLanguage);
      }
      
      // Capture bottom-left screen region
      const imageBuffer = await this.screenCapture.captureBottomLeft();
      console.log('Screenshot captured, buffer size:', imageBuffer.length);
      
      // Convert language code to Tesseract format if needed
      const ocrLanguage = this.convertLanguageCode(detectionLanguage);
      
      // Perform OCR
      const detectedText = await this.ocrProcessor.recognizeText(imageBuffer, ocrLanguage);
      console.log('OCR result:', `"${detectedText}"`);
      
      if (!detectedText || detectedText.trim().length === 0) {
        return {
          success: true,
          gameFinished: false,
          detectedText: '',
          mapKey: null,
          confidence: 0.0,
          thresholdMet: false
        };
      }

      const isFinished = await this.mapTranslator.isGameFinished(detectedText, detectionLanguage);
      if (isFinished) {
        console.log('Game finished detected, skipping map detection');
        this.resetLastDetectedMap();
        return {
          success: true,
          gameFinished: true,
          detectedText,
          mapKey: null,
          confidence: 1.0,
          thresholdMet: false
        };
      }
      
      // Translate to map key
      const mapKey = await this.mapTranslator.translateToMapKey(detectedText, detectionLanguage);
      
      if (mapKey) {
        // Calculate confidence based on text similarity
        const similarity = this.calculateTextSimilarity(detectedText, mapKey, detectionLanguage);
        
        console.log(`Map translation result: ${mapKey}`);
        
        return {
          success: true,
          detectedText,
          gameFinished: false,
          mapKey: mapKey,
          confidence: similarity,
          thresholdMet: true
        };
      } else {
        console.log('No map match found for detected text');
        return {
          success: true,
          detectedText,
          gameFinished: false,
          mapKey: null,
          confidence: 0.0,
          thresholdMet: false
        };
      }
    } catch (error) {
      console.error('Map detection failed:', error);
      return {
        success: false,
        error: error.message,
        detectedText: '',
        mapKey: null,
        confidence: 0.0
      };
    }
  }

  convertLanguageCode(detectionLanguage) {
    // Convert our language codes to Tesseract language codes
    const languageMap = {
      'en': 'eng',
      'de': 'deu',
      'fr': 'fra', 
      'es': 'spa',
      'ru': 'rus',
      'it': 'ita',
      'pt': 'por',
      'ja': 'jpn',
      'ko': 'kor',
      'zh': 'chi_sim'
    };
    
    return languageMap[detectionLanguage] || 'eng';
  }

  calculateTextSimilarity(detectedText, mapKey, language) {
    // Get the expected text for this map in the given language
    const languageTranslations = this.mapTranslator.translations.get(language);
    if (!languageTranslations) return 0.0;

    // Find the translated name for this map key
    const expectedText = Object.keys(languageTranslations).find(
      translatedName => languageTranslations[translatedName] === mapKey
    );

    if (!expectedText) return 0.0;

    // Use the similarity calculation from MapTranslator
    return this.mapTranslator.calculateSimilarity(
      detectedText.toLowerCase().trim(),
      expectedText.toLowerCase().trim()
    );
  }

  startContinuousDetection(interval = null, language = null) {
    console.log('Request to start continuous detection received');
    if (this.isDetecting) {
      console.log('Detection already running');
      return;
    }
    
    // Use parameters or fall back to settings
    const detectionInterval = interval || parseInt(this.settings.getSetting('detectionInterval', '5000'));
    const detectionLanguage = language || this.settings.getSetting('detectionLanguage', 'en');
    
    console.log(`Starting continuous detection: interval=${detectionInterval}ms, language=${detectionLanguage}`);
    
    // Reset last detected map when starting detection
    this.resetLastDetectedMap();
    
    this.isDetecting = true;
    let creator = this.settings.getSetting('mapCreatorFilter', '');
    this.detectionInterval = setInterval(async () => {
      try {
        const result = await this.detectMap(detectionLanguage);

        console.log('Detection result:', result);

        if (result.success && result.gameFinished) {
          await this.triggerMapDisplay("");
          console.log("Game finished detected, map display cleared");
          return
        }
        
        // Trigger automatic map display if a map was detected with sufficient confidence
        if (result.success && result.mapKey && result.thresholdMet) {
          let fullMapKey = creator + "/" + result.mapKey;
          console.log("Full Map Key: " + fullMapKey);
          await this.triggerMapDisplay(fullMapKey);
          console.log(`Map detected: ${result.mapKey} (confidence: ${(result.confidence * 100).toFixed(1)}%)`);
        }
        
        // Send result to renderer process
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send('map-detected', result);
        }
        
        // Optionally log when process is not running (can be disabled to reduce log spam)
        if (result.processNotRunning) {
          // console.log('Target process not running, skipping detection');
        }
      } catch (error) {
        console.error('Error during continuous detection:', error);
      }
    }, detectionInterval);
    
    console.log('Continuous map detection started');
  }

  stopContinuousDetection() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
      console.log('Detection interval cleared');
    }
    
    if (this.isDetecting) {
      this.isDetecting = false;
      // Reset last detected map when stopping detection
      this.resetLastDetectedMap();
      console.log('Continuous map detection stopped');
    }
  }

  async cleanup() {
    this.stopContinuousDetection();
    await this.ocrProcessor.cleanup();
    
    // Cleanup screen capture
    if (this.screenCapture && typeof this.screenCapture.cleanup === 'function') {
      await this.screenCapture.cleanup();
    }
    
    console.log('Map detection service cleaned up');
  }
}

module.exports = MapDetectionService;