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

    // Normalize detected text
    const normalizedText = detectedText.toLowerCase().trim();
    
    // Try exact match first
    for (const [translatedName, mapKey] of Object.entries(languageTranslations)) {
      if (translatedName.toLowerCase() === normalizedText) {
        return mapKey;
      }
    }

    // Try partial match with similarity scoring
    let bestMatch = null;
    let bestScore = 0;

    for (const [translatedName, mapKey] of Object.entries(languageTranslations)) {
      const score = this.calculateSimilarity(normalizedText, translatedName.toLowerCase());
      if (score > bestScore && score > 0.7) { // 70% similarity threshold
        bestScore = score;
        bestMatch = mapKey;
      }
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