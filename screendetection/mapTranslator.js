const fs = require('fs').promises;
const path = require('path');

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
    const normalizedText = detectedText.toLowerCase().trim();
    // Get finish keyword for the language
    const finishKeyword = languageTranslations.keywords?.finish;
    if (!finishKeyword) return null;

    // Try exact match first
    if (normalizedText === finishKeyword.toLowerCase()) {
      return true;
    }

    // Try partial match with similarity scoring
    const score = this.calculateSimilarity(normalizedText, finishKeyword.toLowerCase());
    const finishConfidence = parseFloat(await this.settings.getSetting('finishConfidence') || '0.9');
    console.log("Finish similarity score:", score);
    return score >= finishConfidence; 
  }

  async translateToMapKey(detectedText, language) {
    const languageTranslations = this.translations.get(language);
    if (!languageTranslations) return null;

    // Normalize detected text
    const normalizedText = detectedText.toLowerCase().trim();

    // Use only the maps section for translation
    const maps = languageTranslations.maps || {};

    // Try exact match first
    for (const [translatedName, mapKey] of Object.entries(maps)) {
      if (translatedName.toLowerCase() === normalizedText) {
        return mapKey;
      }
    }

    // Try partial match with similarity scoring
    let bestMatch = null;
    let bestScore = 0;

    const detectionConfidence = parseFloat(await this.settings.getSetting('detectionConfidence') || '0.7');

    for (const [translatedName, mapKey] of Object.entries(maps)) {
      const score = this.calculateSimilarity(normalizedText, translatedName.toLowerCase());
      if (score > bestScore && score > detectionConfidence) { // 70% similarity threshold
        bestScore = score;
        bestMatch = mapKey;
      }
    }

    return bestMatch;
  }


  calculateSimilarity(str1, str2) {
    // Normalize strings
    const normalizedStr1 = str1.toLowerCase().trim();
    const normalizedStr2 = str2.toLowerCase().trim();
    
    if (normalizedStr1.length === 0 || normalizedStr2.length === 0) return 0;
    
    // Check for exact substring match first
    if (normalizedStr1.includes(normalizedStr2) || normalizedStr2.includes(normalizedStr1)) {
      return 1.0;
    }
    
    // Try consecutive word matching for better accuracy
    const score = this.calculateConsecutiveWordMatch(normalizedStr1, normalizedStr2);
    if (score > 0) {
      return score;
    }
    
    // Fallback to character-based similarity with shorter string normalization
    const longer = normalizedStr1.length > normalizedStr2.length ? normalizedStr1 : normalizedStr2;
    const shorter = normalizedStr1.length > normalizedStr2.length ? normalizedStr2 : normalizedStr1;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return Math.max(0, (shorter.length - editDistance) / shorter.length);
  }

  calculateConsecutiveWordMatch(str1, str2) {
    // Split into words, filtering out very short words that are likely OCR artifacts
    const words1 = str1.split(/[\s\-_]+/).filter(word => word.length >= 2);
    const words2 = str2.split(/[\s\-_]+/).filter(word => word.length >= 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const longerWords = words1.length > words2.length ? words1 : words2;
    const shorterWords = words1.length > words2.length ? words2 : words1;
    
    // Look for consecutive word matches
    let bestConsecutiveScore = 0;
    
    for (let i = 0; i <= longerWords.length - shorterWords.length; i++) {
      let consecutiveMatches = 0;
      let totalSimilarity = 0;
      
      for (let j = 0; j < shorterWords.length; j++) {
        const longWord = longerWords[i + j];
        const shortWord = shorterWords[j];
        
        // Check for exact match or very close match
        if (longWord === shortWord) {
          consecutiveMatches++;
          totalSimilarity += 1.0;
        } else if (longWord.includes(shortWord) || shortWord.includes(longWord)) {
          consecutiveMatches++;
          totalSimilarity += 0.9;
        } else {
          // Allow for minor OCR errors
          const wordSimilarity = this.calculateWordSimilarity(longWord, shortWord);
          if (wordSimilarity > 0.7) { // High threshold for individual words
            consecutiveMatches++;
            totalSimilarity += wordSimilarity;
          } else {
            break; // Break consecutive matching
          }
        }
      }
      
      // Score based on how many consecutive words matched
      if (consecutiveMatches === shorterWords.length) {
        const avgSimilarity = totalSimilarity / shorterWords.length;
        bestConsecutiveScore = Math.max(bestConsecutiveScore, avgSimilarity * 0.95); // Slight penalty for word-based vs exact match
      }
    }
    
    return bestConsecutiveScore;
  }

  calculateWordSimilarity(word1, word2) {
    if (word1.length === 0 || word2.length === 0) return 0;
    
    const longer = word1.length > word2.length ? word1 : word2;
    const shorter = word1.length > word2.length ? word2 : word1;
    
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