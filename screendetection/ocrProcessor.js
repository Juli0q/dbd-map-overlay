const Tesseract = require('tesseract.js');
const path = require('path');

class OCRProcessor {
  constructor() {
    this.worker = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    this.worker = await Tesseract.createWorker();
    
    // Configure Tesseract for better text recognition
    await this.worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -\'',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    this.isInitialized = true;
  }

  async recognizeText(imageBuffer, language = 'eng') {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const { data: { text } } = await this.worker.recognize(imageBuffer);
      return text.trim();
    } catch (error) {
      console.error('OCR recognition failed:', error);
      throw error;
    }
  }

  async cleanup() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
    }
  }
}

module.exports = OCRProcessor;