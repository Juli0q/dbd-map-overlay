
const fs = require('fs').promises;
const path = require('path');
const fuzz = require('fuzzball');

class MapTranslator {
  constructor(settingsManager) {
    this.translations = new Map();
    this.loadedLanguages = new Set();
    this.settings = settingsManager;
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

  async isGameFinished(detectedText, language) {
    const languageTranslations = this.translations.get(language);
    if (!languageTranslations) return null;

    // Get finish keyword for the language
    const finishKeyword = languageTranslations.keywords?.finish;
    if (!finishKeyword) return null;

    const finishConfidence = parseFloat(await this.settings.getSetting('finishConfidence') || '0.7');
    
    // Use fuzzy matching with multiple algorithms
    const normalizedText = this.normalizeOCRText(detectedText);
    const normalizedKeyword = finishKeyword.toLowerCase();
    
    // Try multiple fuzzy matching approaches
    const ratioScore = fuzz.ratio(normalizedText, normalizedKeyword) / 100;
    const partialRatio = fuzz.partial_ratio(normalizedText, normalizedKeyword) / 100;
    const tokenSort = fuzz.token_sort_ratio(normalizedText, normalizedKeyword) / 100;
    const tokenSet = fuzz.token_set_ratio(normalizedText, normalizedKeyword) / 100;
    
    // Take the best score from all methods
    const bestScore = Math.max(ratioScore, partialRatio, tokenSort, tokenSet);
    
    console.log(`Finish detection scores for "${finishKeyword}":`, {
      text: normalizedText,
      ratio: ratioScore,
      partial: partialRatio,
      tokenSort: tokenSort,
      tokenSet: tokenSet,
      best: bestScore,
      threshold: finishConfidence
    });

    return bestScore >= finishConfidence;
  }

  async translateToMapKey(detectedText, language) {
    const languageTranslations = this.translations.get(language);
    if (!languageTranslations) return null;

    const maps = languageTranslations.maps || {};
    const detectionConfidence = parseFloat(await this.settings.getSetting('detectionConfidence') || '0.6');
    
    const normalizedText = this.normalizeOCRText(detectedText);
    
    let bestMatch = null;
    let bestScore = 0;
    let bestMethod = '';

    // Try fuzzy matching against all map names
    for (const [mapName, mapKey] of Object.entries(maps)) {
      const normalizedMapName = mapName.toLowerCase();
      
      // Use multiple fuzzy matching algorithms
      const ratioScore = fuzz.ratio(normalizedText, normalizedMapName) / 100;
      const partialRatio = fuzz.partial_ratio(normalizedText, normalizedMapName) / 100;
      const tokenSort = fuzz.token_sort_ratio(normalizedText, normalizedMapName) / 100;
      const tokenSet = fuzz.token_set_ratio(normalizedText, normalizedMapName) / 100;
      
      // Also try matching against individual words in the map name
      const words = normalizedMapName.split(/[\s\-_]+/).filter(word => word.length > 2);
      let wordMatchScore = 0;
      
      for (const word of words) {
        const wordRatio = fuzz.partial_ratio(normalizedText, word) / 100;
        wordMatchScore = Math.max(wordMatchScore, wordRatio);
      }
      
      // Take the best score from all methods
      const currentBestScore = Math.max(ratioScore, partialRatio, tokenSort, tokenSet, wordMatchScore * 0.9);
      
      console.log(`Map matching scores for "${mapName}":`, {
        text: normalizedText,
        ratio: ratioScore,
        partial: partialRatio,
        tokenSort: tokenSort,
        tokenSet: tokenSet,
        wordMatch: wordMatchScore,
        best: currentBestScore
      });
      
      if (currentBestScore > bestScore && currentBestScore >= detectionConfidence) {
        bestScore = currentBestScore;
        bestMatch = mapKey;
        bestMethod = currentBestScore === ratioScore ? 'ratio' : 
                    currentBestScore === partialRatio ? 'partial' : 
                    currentBestScore === tokenSort ? 'token_sort' : 
                    currentBestScore === tokenSet ? 'token_set' : 'word_match';
      }
    }

    if (bestMatch) {
      console.log(`Best match: "${bestMatch}" with score ${bestScore} using method: ${bestMethod}`);
    }

    return bestMatch;
  }

  normalizeOCRText(text) {
    return text
      .toLowerCase()
      .trim()
      // Remove common OCR artifacts
      .replace(/[^\w\s\-]/g, ' ')  // Remove special characters except hyphens
      .replace(/\s+/g, ' ')        // Normalize whitespace
      .replace(/[0-9]/g, '')       // Remove numbers (often OCR noise)
      .trim();
  }

  // Keep the old methods as fallback, but they shouldn't be needed now
  calculateSimilarity(str1, str2) {
    // Fallback to fuzzball if needed
    return fuzz.ratio(str1, str2) / 100;
  }

  calculateConsecutiveWordMatch(str1, str2) {
    return fuzz.token_sort_ratio(str1, str2) / 100;
  }

  calculateWordSimilarity(word1, word2) {
    return fuzz.ratio(word1, word2) / 100;
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