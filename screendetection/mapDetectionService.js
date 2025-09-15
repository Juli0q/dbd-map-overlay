const { app, BrowserWindow, ipcMain } = require('electron');
const ScreenCapture = require('./screenshotCapture');
const OCRProcessor = require('./ocrProcessor');
const MapTranslator = require('./mapTranslator');
const fs = require('fs');
const path = require('path');

class MapDetectionService {
  constructor() {
    this.screenCapture = new ScreenCapture();
    this.ocrProcessor = new OCRProcessor();
    this.mapTranslator = new MapTranslator();
    this.isDetecting = false;
    this.detectionInterval = null;
    this.settingsPath = path.join(app.getPath('userData'), 'settings-app.json');
    
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
    const settings = this.loadSettingsSync();
    const detectionLanguage = settings.detectionLanguage || 'en';
    
    // Set screenshot backend from settings
    const screenshotBackend = settings.screenshotBackend || 'auto';
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

  loadSettingsSync() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const settingsData = fs.readFileSync(this.settingsPath, 'utf-8');
        return JSON.parse(settingsData);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
    return {};
  }

  getSetting(key, defaultValue = null) {
    const settings = this.loadSettingsSync();
    return settings[key] !== undefined ? settings[key] : defaultValue;
  }

  async detectMap(language = null) {
    try {
      // Get detection parameters from settings
      const detectionLanguage = language || this.getSetting('detectionLanguage', 'en');
      const confidence = parseFloat(this.getSetting('detectionConfidence', '0.7'));

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
          detectedText: '',
          mapKey: null,
          confidence: 0.0,
          thresholdMet: false
        };
      }
      
      // Translate to map key
      const mapKey = this.mapTranslator.translateToMapKey(detectedText, detectionLanguage);
      
      if (mapKey) {
        // Calculate confidence based on text similarity
        const similarity = this.calculateTextSimilarity(detectedText, mapKey, detectionLanguage);
        const meetsConfidence = similarity >= confidence;
        
        console.log(`Map translation result: ${mapKey} (similarity: ${(similarity * 100).toFixed(1)}%)`);
        
        return {
          success: true,
          detectedText,
          mapKey: meetsConfidence ? mapKey : null,
          confidence: similarity,
          thresholdMet: meetsConfidence
        };
      } else {
        console.log('No map match found for detected text');
        return {
          success: true,
          detectedText,
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
    if (this.isDetecting) {
      console.log('Detection already running');
      return;
    }
    
    // Use parameters or fall back to settings
    const detectionInterval = interval || parseInt(this.getSetting('detectionInterval', '5000'));
    const detectionLanguage = language || this.getSetting('detectionLanguage', 'en');
    
    console.log(`Starting continuous detection: interval=${detectionInterval}ms, language=${detectionLanguage}`);
    
    this.isDetecting = true;
    this.detectionInterval = setInterval(async () => {
      try {
        const result = await this.detectMap(detectionLanguage);
        
        // Send result to renderer process
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send('map-detected', result);
        }
        
        // Log successful detections
        if (result.success && result.mapKey && result.thresholdMet) {
          console.log(`Map detected: ${result.mapKey} (confidence: ${(result.confidence * 100).toFixed(1)}%)`);
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
      console.log('Continuous map detection stopped');
    }
  }

  async cleanup() {
    this.stopContinuousDetection();
    await this.ocrProcessor.cleanup();
    console.log('Map detection service cleaned up');
  }
}

module.exports = MapDetectionService;