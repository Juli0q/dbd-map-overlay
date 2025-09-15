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
      // Changed from SINGLE_LINE to SINGLE_BLOCK to handle multiple lines
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    });

    this.isInitialized = true;
  }

  async recognizeText(imageBuffer, language = 'eng') {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const { data: { text } } = await this.worker.recognize(imageBuffer);
      
      // Clean up the text and return all lines
      const cleanedText = text
        .trim()
        .replace(/\n+/g, '\n') // Normalize multiple newlines to single newlines
        .replace(/\s+/g, ' '); // Normalize multiple spaces to single spaces
      
      return cleanedText;
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