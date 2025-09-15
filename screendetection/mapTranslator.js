const fs = require('fs').promises;
const path = require('path');

class MapTranslator {
  constructor() {
    this.translations = new Map();
    this.loadedLanguages = new Set();
  }

  async loadLanguage(language) {
    if (this.loadedLanguages.has(language)) return;

    try {
      const filePath = path.join(__dirname, 'translations', `${language}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      const translations = JSON.parse(data);
      
      this.translations.set(language, translations);
      this.loadedLanguages.add(language);
    } catch (error) {
      console.error(`Failed to load translations for ${language}:`, error);
    }
  }

  translateToMapKey(detectedText, language) {
    const languageTranslations = this.translations.get(language);
    if (!languageTranslations) return null;

    // Split the detected text into lines and also keep the full text
    const lines = detectedText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const fullText = detectedText.replace(/\n/g, ' ').trim();
    
    // Create array of all text variants to test
    const textVariants = [
      fullText,           // Full text with newlines replaced by spaces
      ...lines           // Each individual line
    ];

    console.log('OCR text variants to test:', textVariants);

    // Try exact match first on all variants
    for (const textVariant of textVariants) {
      const normalizedText = textVariant.toLowerCase().trim();
      
      for (const [translatedName, mapKey] of Object.entries(languageTranslations)) {
        if (translatedName.toLowerCase() === normalizedText) {
          console.log(`Exact match found: "${textVariant}" -> ${mapKey}`);
          return mapKey;
        }
      }
    }

    // Try partial match with similarity scoring on all variants
    let bestMatch = null;
    let bestScore = 0;
    let bestMatchText = '';

    for (const textVariant of textVariants) {
      const normalizedText = textVariant.toLowerCase().trim();
      
      if (normalizedText.length === 0) continue;

      for (const [translatedName, mapKey] of Object.entries(languageTranslations)) {
        const score = this.calculateSimilarity(normalizedText, translatedName.toLowerCase());
        if (score > bestScore && score > 0.6) { // Lower threshold to 60% for more flexibility
          bestScore = score;
          bestMatch = mapKey;
          bestMatchText = textVariant;
        }
      }
    }

    if (bestMatch) {
      console.log(`Best similarity match: "${bestMatchText}" -> ${bestMatch} (score: ${(bestScore * 100).toFixed(1)}%)`);
    }

    return bestMatch;
  }

  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j - 1][i] + 1,
          matrix[j][i - 1] + 1,
          matrix[j - 1][i - 1] + cost
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }
}

module.exports = MapTranslator;