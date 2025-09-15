const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class SettingsManager {
  constructor(settingsFileName = 'settings-app.json') {
    this.settingsPath = path.join(app.getPath('userData'), settingsFileName);
    this._cachedSettings = null;
    this._cacheExpiry = 0;
    this._cacheTimeout = 1000; // Cache for 1 second to avoid frequent file reads
  }

  /**
   * Load settings synchronously with caching
   * @returns {Object} Settings object
   */
  loadSettingsSync() {
    const now = Date.now();
    
    // Return cached settings if still valid
    if (this._cachedSettings && now < this._cacheExpiry) {
      return this._cachedSettings;
    }

    try {
      if (fs.existsSync(this.settingsPath)) {
        const settingsData = fs.readFileSync(this.settingsPath, 'utf-8');
        this._cachedSettings = JSON.parse(settingsData);
        this._cacheExpiry = now + this._cacheTimeout;
        return this._cachedSettings;
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
    
    this._cachedSettings = {};
    this._cacheExpiry = now + this._cacheTimeout;
    return this._cachedSettings;
  }

  /**
   * Load settings asynchronously with caching
   * @returns {Promise<Object>} Settings object
   */
  async loadSettings() {
    const now = Date.now();
    
    // Return cached settings if still valid
    if (this._cachedSettings && now < this._cacheExpiry) {
      return this._cachedSettings;
    }

    try {
      if (await this.fileExists(this.settingsPath)) {
        const settingsData = await fs.promises.readFile(this.settingsPath, 'utf-8');
        this._cachedSettings = JSON.parse(settingsData);
        this._cacheExpiry = now + this._cacheTimeout;
        return this._cachedSettings;
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
    
    this._cachedSettings = {};
    this._cacheExpiry = now + this._cacheTimeout;
    return this._cachedSettings;
  }

  /**
   * Get a specific setting value
   * @param {string} key - Setting key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @returns {*} Setting value
   */
  getSetting(key, defaultValue = null) {
    const settings = this.loadSettingsSync();
    return settings[key] !== undefined ? settings[key] : defaultValue;
  }

  /**
   * Get a specific setting value asynchronously
   * @param {string} key - Setting key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @returns {Promise<*>} Setting value
   */
  async getSettingAsync(key, defaultValue = null) {
    const settings = await this.loadSettings();
    return settings[key] !== undefined ? settings[key] : defaultValue;
  }

  /**
   * Set a setting value
   * @param {string} key - Setting key
   * @param {*} value - Setting value
   * @returns {Promise<boolean>} Success status
   */
  async setSetting(key, value) {
    try {
      const settings = await this.loadSettings();
      settings[key] = value;
      await this.saveSettings(settings);
      return true;
    } catch (error) {
      console.error('Failed to set setting:', error);
      return false;
    }
  }

  /**
   * Set multiple settings at once
   * @param {Object} newSettings - Object containing key-value pairs to set
   * @returns {Promise<boolean>} Success status
   */
  async setSettings(newSettings) {
    try {
      const settings = await this.loadSettings();
      Object.assign(settings, newSettings);
      await this.saveSettings(settings);
      return true;
    } catch (error) {
      console.error('Failed to set settings:', error);
      return false;
    }
  }

  /**
   * Save settings to file
   * @param {Object} settings - Settings object to save
   * @returns {Promise<void>}
   */
  async saveSettings(settings) {
    try {
      // Ensure directory exists
      await fs.promises.mkdir(path.dirname(this.settingsPath), { recursive: true });
      
      // Write settings file
      await fs.promises.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      
      // Update cache
      this._cachedSettings = settings;
      this._cacheExpiry = Date.now() + this._cacheTimeout;
      
      console.log(`Settings saved to: ${this.settingsPath}`);
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  }

  /**
   * Delete a setting
   * @param {string} key - Setting key to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteSetting(key) {
    try {
      const settings = await this.loadSettings();
      if (key in settings) {
        delete settings[key];
        await this.saveSettings(settings);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to delete setting:', error);
      return false;
    }
  }

  /**
   * Check if settings file exists
   * @returns {Promise<boolean>}
   */
  async fileExists(filepath) {
    try {
      await fs.promises.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all settings
   * @returns {Object} All settings
   */
  getAllSettings() {
    return this.loadSettingsSync();
  }

  /**
   * Get all settings asynchronously
   * @returns {Promise<Object>} All settings
   */
  async getAllSettingsAsync() {
    return await this.loadSettings();
  }

  /**
   * Reset all settings (delete the settings file)
   * @returns {Promise<boolean>} Success status
   */
  async resetSettings() {
    try {
      if (await this.fileExists(this.settingsPath)) {
        await fs.promises.unlink(this.settingsPath);
      }
      this._cachedSettings = {};
      this._cacheExpiry = Date.now() + this._cacheTimeout;
      console.log('Settings file deleted');
      return true;
    } catch (error) {
      console.error('Failed to reset settings:', error);
      return false;
    }
  }

  /**
   * Clear the settings cache (force reload on next access)
   */
  clearCache() {
    this._cachedSettings = null;
    this._cacheExpiry = 0;
  }

  /**
   * Get the settings file path
   * @returns {string} Settings file path
   */
  getSettingsPath() {
    return this.settingsPath;
  }
}

module.exports = SettingsManager;