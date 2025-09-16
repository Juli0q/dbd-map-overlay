const fs = require('fs').promises;
const path = require('path');
const fuzz = require('fuzzball');

class MapTranslator {
  constructor(settingsManager) {
    this.translations = new Map();
    this.loadedLanguages = new Set();
    this.settings = settingsManager;
    this.matchLogFile = path.join(__dirname, 'logs', 'match-success.log');
    this.ensureLogDirectory();
  }

  async ensureLogDirectory() {
    try {
      const logDir = path.dirname(this.matchLogFile);
      await fs.mkdir(logDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create logs directory:', error);
    }
  }

  async logSuccessfulMatch(matchType, inputString, matchedWith, matchPosition, score, method, threshold) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      matchType, // 'MAP' or 'FINISH'
      inputString: inputString.trim(),
      normalizedInput: this.normalizeOCRText(inputString),
      matchedWith,
      matchPosition: matchPosition || 'N/A',
      score: parseFloat(score.toFixed(4)),
      method,
      threshold: parseFloat(threshold.toFixed(4)),
      success: true
    };

    const logLine = `[${timestamp}] ${matchType} MATCH SUCCESS\n` +
                   `  Input: "${inputString.trim()}"\n` +
                   `  Normalized: "${logEntry.normalizedInput}"\n` +
                   `  Matched with: "${matchedWith}"\n` +
                   `  Match position: ${matchPosition || 'Full string'}\n` +
                   `  Score: ${logEntry.score} (threshold: ${logEntry.threshold})\n` +
                   `  Method: ${method}\n` +
                   `  Raw data: ${JSON.stringify(logEntry)}\n` +
                   `${'='.repeat(80)}\n\n`;

    try {
      await fs.appendFile(this.matchLogFile, logLine, 'utf8');
    } catch (error) {
      console.error('Failed to write to match log file:', error);
    }
  }

  findMatchPosition(inputString, matchedString, method) {
    const normalizedInput = this.normalizeOCRText(inputString);
    const normalizedMatch = matchedString.toLowerCase();

    // For different matching methods, try to identify where the match occurred
    switch (method) {
      case 'partial':
        // Find the best substring match
        let bestPos = -1;
        let bestScore = 0;
        for (let i = 0; i <= normalizedInput.length - normalizedMatch.length; i++) {
          const substring = normalizedInput.substring(i, i + normalizedMatch.length);
          const score = fuzz.ratio(substring, normalizedMatch);
          if (score > bestScore) {
            bestScore = score;
            bestPos = i;
          }
        }
        return bestPos >= 0 ? `Position ${bestPos}-${bestPos + normalizedMatch.length}` : 'Not found';
      
      case 'word_match':
        // Find which words matched
        const inputWords = normalizedInput.split(/\s+/);
        const matchWords = normalizedMatch.split(/\s+/);
        const matchedWords = [];
        
        matchWords.forEach(matchWord => {
          inputWords.forEach((inputWord, index) => {
            if (fuzz.partial_ratio(inputWord, matchWord) > 80) {
              matchedWords.push(`"${inputWord}" (word ${index + 1})`);
            }
          });
        });
        
        return matchedWords.length > 0 ? `Words: ${matchedWords.join(', ')}` : 'Word boundary match';
      
      case 'token_sort':
      case 'token_set':
        return 'Token-based match (reordered words)';
      
      default:
        return 'Full string comparison';
    }
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
    let bestMethod = ratioScore === bestScore ? 'ratio' : 
                    partialRatio === bestScore ? 'partial' : 
                    tokenSort === bestScore ? 'token_sort' : 'token_set';
    
    console.log(`Finish detection scores for "${finishKeyword}":`, {
      text: normalizedText,
      ratio: ratioScore,
      partial: partialRatio,
      tokenSort: tokenSort,
      tokenSet: tokenSet,
      best: bestScore,
      threshold: finishConfidence
    });

    const isMatch = bestScore >= finishConfidence;
    
    // Log successful matches
    if (isMatch) {
      const matchPosition = this.findMatchPosition(detectedText, finishKeyword, bestMethod);
      await this.logSuccessfulMatch(
        'FINISH',
        detectedText,
        finishKeyword,
        matchPosition,
        bestScore,
        bestMethod,
        finishConfidence
      );
    }

    return isMatch;
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
    let bestMapName = '';

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
      
      //console.log(`Map matching scores for "${mapName}":`, {
      //  text: normalizedText,
      //  ratio: ratioScore,
      //  partial: partialRatio,
      //  tokenSort: tokenSort,
      //  tokenSet: tokenSet,
      //  wordMatch: wordMatchScore,
      //  best: currentBestScore
      //});
      
      if (currentBestScore > bestScore && currentBestScore >= detectionConfidence) {
        bestScore = currentBestScore;
        bestMatch = mapKey;
        bestMapName = mapName;
        bestMethod = currentBestScore === ratioScore ? 'ratio' : 
                    currentBestScore === partialRatio ? 'partial' : 
                    currentBestScore === tokenSort ? 'token_sort' : 
                    currentBestScore === tokenSet ? 'token_set' : 'word_match';
      }
    }

    if (bestMatch) {
      console.log(`Best match: "${bestMatch}" with score ${bestScore} using method: ${bestMethod}`);
      
      // Log successful match with detailed information
      const matchPosition = this.findMatchPosition(detectedText, bestMapName, bestMethod);
      await this.logSuccessfulMatch(
        'MAP',
        detectedText,
        `${bestMapName} (key: ${bestMatch})`,
        matchPosition,
        bestScore,
        bestMethod,
        detectionConfidence
      );
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