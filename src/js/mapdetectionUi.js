// Map Detection UI Logic (without context isolation)
class MapDetectionUI {
    constructor(settings) {
        this.isDetecting = false;
        this.testMode = false;
        this.ipcRenderer = require('electron').ipcRenderer;
        this.settings = settings;
        this.availableBackends = {};
        this.setupEventListeners();
        
        // Only load settings if settings object is valid
        if (this.settings && typeof this.settings.get === 'function') {
            this.loadSettings();
            this.initializeScreenshotBackend();
        } else {
            console.warn('MapDetectionUI: Settings object not provided or invalid');
        }
    }

    async initializeScreenshotBackend() {
        try {
            // Get available backends from main process
            const backendInfo = await this.ipcRenderer.invoke('get-screenshot-info');
            this.availableBackends = backendInfo.availableBackends;
            
            // Update dropdown options based on available backends
            this.updateBackendDropdown();
            
            // Update info display
            this.updateBackendInfo();
        } catch (error) {
            console.error('Failed to initialize screenshot backend:', error);
        }
    }

    updateBackendDropdown() {
        const dropdown = document.getElementById('screenshotBackend');
        if (!dropdown) return;

        // Clear existing options except auto
        dropdown.innerHTML = '<option value="auto">Auto-detect (Recommended)</option>';
        
        // Add available backends
        Object.entries(this.availableBackends).forEach(([key, description]) => {
            if (key !== 'auto') {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = description;
                dropdown.appendChild(option);
            }
        });
    }

    async updateBackendInfo() {
        try {
            const info = await this.ipcRenderer.invoke('get-screenshot-info');
            const infoBadge = document.getElementById('screenshotBackendInfo');
            
            if (infoBadge) {
                const backendName = this.availableBackends[info.selectedBackend] || info.selectedBackend;
                infoBadge.textContent = `Current: ${backendName}`;
                
                // Update badge color based on platform
                infoBadge.className = 'badge text-dark ' + 
                    (info.isWayland ? 'bg-warning' : 
                     info.platform === 'win32' ? 'bg-success' : 'bg-info');
            }
        } catch (error) {
            console.error('Failed to update backend info:', error);
        }
    }

    setupEventListeners() {
        // Screenshot backend selection
        const backendDropdown = document.getElementById('screenshotBackend');
        if (backendDropdown) {
            backendDropdown.addEventListener('change', async (e) => {
                const backend = e.target.value;
                try {
                    await this.ipcRenderer.invoke('set-screenshot-backend', backend);
                    
                    // Only save to settings if settings object is available
                    if (this.settings && typeof this.settings.set === 'function') {
                        await this.settings.set('screenshotBackend', backend);
                    }
                    
                    await this.updateBackendInfo();
                    
                    // Show success message
                    this.updateStatus(`Screenshot backend changed to: ${backend}`, 'success');
                    setTimeout(() => {
                        const statusDiv = document.getElementById('detectionStatus');
                        if (statusDiv) statusDiv.style.display = 'none';
                    }, 3000);
                } catch (error) {
                    this.displayError(`Failed to change backend: ${error.message}`);
                    // Reset dropdown to previous value
                    if (this.settings && typeof this.settings.get === 'function') {
                        const currentBackend = await this.settings.get('screenshotBackend') || 'auto';
                        e.target.value = currentBackend;
                    } else {
                        e.target.value = 'auto';
                    }
                }
            });
        }

        // Detection controls
        document.getElementById('testDetection')?.addEventListener('click', () => {
            this.performSingleDetection();
        });

        document.getElementById('saveTestImage')?.addEventListener('click', async () => {
            try {
                const result = await this.ipcRenderer.invoke('save-test-image');
                if (result.success) {
                    this.updateStatus(`Test image saved to: ${result.path}`, 'success');
                    setTimeout(() => {
                        const statusDiv = document.getElementById('detectionStatus');
                        if (statusDiv) statusDiv.style.display = 'none';
                    }, 5000);
                }
            } catch (error) {
                this.displayError(`Failed to save test image: ${error.message}`);
            }
        });

        document.getElementById('startTestDetection')?.addEventListener('click', () => {
            this.startContinuousDetection(true);
        });

        document.getElementById('stopTestDetection')?.addEventListener('click', () => {
            this.stopDetection();
        });

        // Settings changes
        document.getElementById('enableMapDetection')?.addEventListener('change', async (e) => {
            if (this.settings && typeof this.settings.set === 'function') {
                await this.settings.set('enableMapDetection', e.target.checked);
            }
            
            if (e.target.checked && !this.testMode) {
                this.startContinuousDetection(false);
            } else if (!e.target.checked) {
                this.stopDetection();
            }
        });

        document.getElementById('detectionLanguage')?.addEventListener('change', async (e) => {
            if (this.settings && typeof this.settings.set === 'function') {
                await this.settings.set('detectionLanguage', e.target.value);
            }
        });

        document.getElementById('detectionInterval')?.addEventListener('change', async (e) => {
            if (this.settings && typeof this.settings.set === 'function') {
                await this.settings.set('detectionInterval', e.target.value);
            }
            
            if (this.isDetecting) {
                this.stopDetection();
                const enabled = document.getElementById('enableMapDetection')?.checked;
                if (enabled) {
                    this.startContinuousDetection(false);
                }
            }
        });

        const confidenceSlider = document.getElementById('detectionConfidence');
        if (confidenceSlider) {
            confidenceSlider.addEventListener('input', async (e) => {
                const value = Math.round(e.target.value * 100);
                const confidenceValueLabel = document.getElementById('confidenceValue');
                if (confidenceValueLabel) confidenceValueLabel.textContent = `${value}%`;
                
                if (this.settings && typeof this.settings.set === 'function') {
                    await this.settings.set('detectionConfidence', e.target.value);
                }
            });
        }

        // Listen for detection results from main process
        this.ipcRenderer.on('map-detected', (event, result) => {
            this.displayResult(result);
        });
    }

    async performSingleDetection() {
        const language = document.getElementById('detectionLanguage')?.value || 'en';
        this.updateStatus('Detecting...', 'info');
        
        try {
            const result = await this.ipcRenderer.invoke('detect-map', language);
            this.displayResult(result);
        } catch (error) {
            this.displayError(`Detection failed: ${error.message}`);
        }
    }

    async startContinuousDetection(testMode = false) {
        if (this.isDetecting) return;

        const language = document.getElementById('detectionLanguage')?.value || 'en';
        const interval = parseInt(document.getElementById('detectionInterval')?.value || '5000');
        
        try {
            await this.ipcRenderer.invoke('start-detection', interval, language);
            this.isDetecting = true;
            this.testMode = testMode;
            
            if (testMode) {
                this.updateStatus('Continuous test detection started...', 'info');
                document.getElementById('startTestDetection').disabled = true;
                document.getElementById('stopTestDetection').disabled = false;
            } else {
                this.updateStatus('Automatic map detection started...', 'success');
            }
        } catch (error) {
            this.displayError(`Failed to start detection: ${error.message}`);
        }
    }

    async stopDetection() {
        if (!this.isDetecting) return;

        try {
            await this.ipcRenderer.invoke('stop-detection');
            this.isDetecting = false;
            
            if (this.testMode) {
                this.updateStatus('Test detection stopped', 'info');
                document.getElementById('startTestDetection').disabled = false;
                document.getElementById('stopTestDetection').disabled = true;
                this.testMode = false;
            } else {
                this.updateStatus('Automatic map detection stopped', 'warning');
            }
        } catch (error) {
            this.displayError(`Failed to stop detection: ${error.message}`);
        }
    }

    displayResult(result) {
        console.log(result)
        const resultDiv = document.getElementById('detectionResult');
        const alertDiv = document.getElementById('detectionResultAlert');
        const contentDiv = document.getElementById('detectionResultContent');
        
        if (!resultDiv || !alertDiv || !contentDiv) return;
        
        resultDiv.style.display = 'block';
        
        if (result.success && result.mapKey) {
            // Map was successfully detected and passes confidence threshold
            alertDiv.className = 'alert alert-success';
            contentDiv.innerHTML = `
                <p><strong>Map Detected:</strong> ${result.mapKey}</p>
                <p><strong>Raw Text:</strong> "${result.detectedText}"</p>
                <p><strong>Confidence:</strong> ${(result.confidence * 100).toFixed(1)}%</p>
                ${result.rawConfidence !== undefined && result.rawConfidence !== result.confidence ? 
                    `<p><strong>Raw Confidence:</strong> ${(result.rawConfidence * 100).toFixed(1)}%</p>` : ''}
                ${result.thresholdMet !== undefined ? 
                    `<p><strong>Threshold Met:</strong> ${result.thresholdMet ? 'Yes' : 'No'}</p>` : ''}
                <p><strong>Time:</strong> ${new Date().toLocaleTimeString()}</p>
            `;
            
            // If not in test mode, trigger map selection
            if (!this.testMode && window.selectMapByKey) {
                window.selectMapByKey(result.mapKey);
            }
            
        } else if (result.success && result.detectedText && result.rawConfidence !== undefined) {
            // OCR succeeded but confidence is too low or no map match
            alertDiv.className = 'alert alert-warning';
            contentDiv.innerHTML = `
                <p><strong>Text Detected but No Map Match</strong></p>
                <p><strong>Raw Text:</strong> "${result.detectedText}"</p>
                <p><strong>Raw Confidence:</strong> ${(result.rawConfidence * 100).toFixed(1)}%</p>
                <p><strong>Threshold Met:</strong> ${result.thresholdMet ? 'Yes' : 'No'}</p>
                <p><strong>Time:</strong> ${new Date().toLocaleTimeString()}</p>
            `;
        } else if (result.success) {
            // OCR ran but no text detected
            alertDiv.className = 'alert alert-warning';
            contentDiv.innerHTML = `
                <p><strong>No Text Detected</strong></p>
                <p><strong>Raw Text:</strong> "${result.detectedText || 'None'}"</p>
                <p><strong>Time:</strong> ${new Date().toLocaleTimeString()}</p>
            `;
        } else {
            // Detection failed with error
            alertDiv.className = 'alert alert-danger';
            contentDiv.innerHTML = `
                <p><strong>Detection Error:</strong> ${result.error}</p>
                <p><strong>Time:</strong> ${new Date().toLocaleTimeString()}</p>
            `;
        }
    }

    updateStatus(message, type = 'info') {
        const statusDiv = document.getElementById('detectionStatus');
        const contentDiv = document.getElementById('detectionStatusContent');
        
        if (!statusDiv || !contentDiv) return;
        
        statusDiv.style.display = 'block';
        statusDiv.className = `alert alert-${type}`;
        contentDiv.textContent = message;
    }

    displayError(message) {
        this.updateStatus(`Error: ${message}`, 'danger');
    }

    async loadSettings() {
        // Defensive check for settings object
        if (!this.settings || typeof this.settings.get !== 'function') {
            console.warn('MapDetectionUI: Cannot load settings - settings object not available');
            this.setDefaultValues();
            return;
        }

        try {
            // Load settings using the settings service
            const enabled = await this.settings.get('enableMapDetection') || false;
            const language = await this.settings.get('detectionLanguage') || 'en';
            const interval = await this.settings.get('detectionInterval') || '5000';
            const confidence = await this.settings.get('detectionConfidence') || '0.7';
            const backend = await this.settings.get('screenshotBackend') || 'auto';

            // Apply settings to UI
            const enabledCheckbox = document.getElementById('enableMapDetection');
            if (enabledCheckbox) enabledCheckbox.checked = enabled;

            const languageSelect = document.getElementById('detectionLanguage');
            if (languageSelect) languageSelect.value = language;

            const intervalSelect = document.getElementById('detectionInterval');
            if (intervalSelect) intervalSelect.value = interval;

            const confidenceSlider = document.getElementById('detectionConfidence');
            if (confidenceSlider) {
                confidenceSlider.value = confidence;
                const value = Math.round(confidence * 100);
                const confidenceValueLabel = document.getElementById('confidenceValue');
                if (confidenceValueLabel) confidenceValueLabel.textContent = `${value}%`;
            }

            const backendSelect = document.getElementById('screenshotBackend');
            if (backendSelect) {
                backendSelect.value = backend;
                // Trigger change event to ensure backend is set
                setTimeout(async () => {
                    try {
                        await this.ipcRenderer.invoke('set-screenshot-backend', backend);
                    } catch (error) {
                        console.warn('Failed to set initial screenshot backend:', error);
                    }
                }, 500);
            }

            // Auto-start detection if enabled
            if (enabled) {
                setTimeout(() => this.startContinuousDetection(false), 1000);
            }
        } catch (error) {
            console.error('MapDetectionUI: Error loading settings:', error);
            this.setDefaultValues();
        }
    }

    setDefaultValues() {
        // Set default values when settings are not available
        const enabledCheckbox = document.getElementById('enableMapDetection');
        if (enabledCheckbox) enabledCheckbox.checked = false;

        const languageSelect = document.getElementById('detectionLanguage');
        if (languageSelect) languageSelect.value = 'en';

        const intervalSelect = document.getElementById('detectionInterval');
        if (intervalSelect) intervalSelect.value = '5000';

        const confidenceSlider = document.getElementById('detectionConfidence');
        if (confidenceSlider) {
            confidenceSlider.value = '0.7';
            const confidenceValueLabel = document.getElementById('confidenceValue');
            if (confidenceValueLabel) confidenceValueLabel.textContent = '70%';
        }

        const backendSelect = document.getElementById('screenshotBackend');
        if (backendSelect) backendSelect.value = 'auto';
    }
}

module.exports = MapDetectionUI;