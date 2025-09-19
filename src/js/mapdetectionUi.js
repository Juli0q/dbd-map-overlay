

// Map Detection UI Logic (without context isolation)
class MapDetectionUI {
    constructor(settings, images, screenShareRenderer) {
        this.isDetecting = false;
        this.testMode = false;
        this.ipcRenderer = require('electron').ipcRenderer;
        this.settings = settings;
        this.availableBackends = {};
        this.images = images;

        this.setupEventListeners();


        
        // Only load settings if settings object is valid
        if (this.settings && typeof this.settings.get === 'function') {
            this.loadSettings();
            this.initializeScreenshotBackend();
        } else {
            console.warn('MapDetectionUI: Settings object not provided or invalid');
        }

        // Hook into the images loadImages method to populate creator filter after images are loaded
        this.hookIntoImagesLoading();
    }

    // Hook into the Images class to know when the dictionary is populated
    hookIntoImagesLoading() {
        if (!this.images) return;

        // Store the original loadImages method
        const originalLoadImages = this.images.loadImages.bind(this.images);
        
        // Override it to also populate our creator filter
        this.images.loadImages = async () => {
            const result = await originalLoadImages();
            // After images are loaded and dictionary is populated, update our creator filter
            await this.populateCreatorFilter();
            return result;
        };

        // Also hook into displayImages since that's where loadImages gets called
        const originalDisplayImages = this.images.displayImages.bind(this.images);
        this.images.displayImages = async (filter = "") => {
            const result = await originalDisplayImages(filter);
            // Check if we need to populate creator filter (in case it wasn't done before)
            if (this.shouldUpdateCreatorFilter()) {
                await this.populateCreatorFilter();
            }
            return result;
        };
    }

    // Check if we need to update the creator filter
    shouldUpdateCreatorFilter() {
        const creatorFilter = document.getElementById('mapCreatorFilter');
        if (!creatorFilter) return false;
        
        // If we only have the default "All Creators" option and there are creators available
        return creatorFilter.options.length === 1 && 
               this.images && 
               this.images.mapDictionary && 
               Object.keys(this.images.mapDictionary).length > 0;
    }

    // Method to populate the creator filter dropdown
    async populateCreatorFilter() {
        const creatorFilter = document.getElementById('mapCreatorFilter');
        if (!creatorFilter) return;

        try {
            const creators = this.images.getCreators();
            
            // Only populate if we have creators and the dropdown isn't already populated
            if (creators.length === 0 || creatorFilter.options.length > 1) {
                return;
            }

            creators.forEach(creator => {
                const option = document.createElement('option');
                option.value = creator;
                option.textContent = creator;
                creatorFilter.appendChild(option);
            });

            // Restore the saved value if any
            if (this.settings && typeof this.settings.get === 'function') {
                const savedCreator = await this.settings.get('mapCreatorFilter') || '';
                if (savedCreator) {
                    creatorFilter.value = savedCreator;
                }
            }

            console.log('MapDetectionUI: Creator filter populated with', creators.length, 'creators');
        } catch (error) {
            console.error('Failed to populate creator filter:', error);
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

            this.updateScreenshareUi(info)
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

    updateScreenshareUi(info) {
        let screenshareContainer = document.getElementById("screen-share-preview-container");
        // Show or hide the "Change Source" button based on backend and platform
        if (info && info.isWayland && info.selectedBackend === "electron-screenshare") {
            document.getElementById("changeSourceBtn").classList.remove("d-none")
            screenshareContainer.classList.remove("d-none");
        } else {
            document.getElementById("changeSourceBtn").classList.add("d-none")
            screenshareContainer.classList.add("d-none");
            screenShareRenderer.stopCapture()
        }
    }

    setupEventListeners() {
        // Map creator filter selection
        const creatorFilter = document.getElementById('mapCreatorFilter');
        if (creatorFilter) {
            creatorFilter.addEventListener('change', async (e) => {
                if (this.settings && typeof this.settings.set === 'function') {
                    await this.settings.set('mapCreatorFilter', e.target.value);
                }
                
                // Update the main images creator select if it exists
                const mainCreatorSelect = document.getElementById('creatorSelect');
                if (mainCreatorSelect) {
                    mainCreatorSelect.value = e.target.value;
                    // Trigger the change event to update the display
                    mainCreatorSelect.dispatchEvent(new Event('change'));
                }
            });
        }

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

        // Process monitoring controls
        document.getElementById('processCheckEnabled')?.addEventListener('change', async (e) => {
            if (this.settings && typeof this.settings.set === 'function') {
                await this.settings.set('processCheckEnabled', e.target.checked);
            }
        });

        document.getElementById('processPattern')?.addEventListener('change', async (e) => {
            if (this.settings && typeof this.settings.set === 'function') {
                await this.settings.set('processPattern', e.target.value);
            }
        });

        document.getElementById('testProcessPattern')?.addEventListener('click', async () => {
            await this.testProcessPattern();
        });

        document.getElementById('changeSourceBtn').addEventListener('click', async (e) => {
            screenShareRenderer.startCapture()
        });

        document.getElementById('showRunningProcesses')?.addEventListener('click', async () => {
            await this.showRunningProcesses();
        });

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

    async testProcessPattern() {
        const pattern = document.getElementById('processPattern')?.value || 'DeadByDaylight';
        const resultDiv = document.getElementById('processTestResult');
        
        if (!resultDiv) return;
        
        resultDiv.style.display = 'block';
        resultDiv.className = 'alert alert-info';
        resultDiv.innerHTML = 'Testing process pattern...';
        
        try {
            const result = await this.ipcRenderer.invoke('check-process', pattern);
            
            if (result.success) {
                resultDiv.className = result.isRunning ? 'alert alert-success' : 'alert alert-warning';
                resultDiv.innerHTML = `
                    <strong>Pattern:</strong> <code>${pattern}</code><br>
                    <strong>Process ${result.isRunning ? 'found' : 'not found'}</strong>
                    ${result.isRunning ? '<br>✅ Dead by Daylight appears to be running!' : '<br>❌ Process not detected'}
                `;
            } else {
                resultDiv.className = 'alert alert-danger';
                resultDiv.innerHTML = `
                    <strong>Pattern test failed:</strong> ${result.error}<br>
                    Make sure your regex pattern is valid.
                `;
            }
            
            // Hide after 5 seconds
            setTimeout(() => {
                if (resultDiv) resultDiv.style.display = 'none';
            }, 5000);
            
        } catch (error) {
            resultDiv.className = 'alert alert-danger';
            resultDiv.innerHTML = `<strong>Error testing pattern:</strong> ${error.message}`;
        }
    }

    async showRunningProcesses() {
        const listDiv = document.getElementById('runningProcessesList');
        const contentDiv = document.getElementById('processListContent');
        
        if (!listDiv || !contentDiv) return;
        
        // Toggle visibility
        const isVisible = listDiv.classList.contains('show');
        
        if (isVisible) {
            listDiv.classList.remove('show');
            return;
        }
        
        contentDiv.innerHTML = 'Loading running processes...';
        listDiv.classList.add('show');
        
        try {
            const result = await this.ipcRenderer.invoke('get-running-processes');
            
            if (result.success && result.processes) {
                const processes = result.processes.slice(0, 20); // Show first 20
                contentDiv.innerHTML = processes.map(process => 
                    `<div class="mb-1"><code>${process}</code></div>`
                ).join('');
            } else {
                contentDiv.innerHTML = `<div class="text-danger">Failed to get processes: ${result.error || 'Unknown error'}</div>`;
            }
        } catch (error) {
            contentDiv.innerHTML = `<div class="text-danger">Error: ${error.message}</div>`;
        }
    }

    async loadSettings() {
        if (!this.settings) return;

        try {
            // Process monitoring settings
            const processCheckEnabled = await this.settings.get('processCheckEnabled') || false;
            const processPattern = await this.settings.get('processPattern') || 'DeadByDaylight';
            
            const processCheckInput = document.getElementById('processCheckEnabled');
            const processPatternInput = document.getElementById('processPattern');
            
            if (processCheckInput) processCheckInput.checked = processCheckEnabled;
            if (processPatternInput) processPatternInput.value = processPattern;

            // Existing settings
            const enableMapDetection = await this.settings.get('enableMapDetection') || false;
            const detectionLanguage = await this.settings.get('detectionLanguage') || 'en';
            const detectionInterval = await this.settings.get('detectionInterval') || 5000;
            const detectionConfidence = parseFloat(await this.settings.get('detectionConfidence') || '0.7');
            const screenshotBackend = await this.settings.get('screenshotBackend') || 'auto';

            const enableInput = document.getElementById('enableMapDetection');
            const languageSelect = document.getElementById('detectionLanguage');
            const intervalInput = document.getElementById('detectionInterval');
            const confidenceSlider = document.getElementById('detectionConfidence');
            const confidenceLabel = document.getElementById('confidenceValue');
            const backendSelect = document.getElementById('screenshotBackend');

            if (enableInput) enableInput.checked = enableMapDetection;
            if (languageSelect) languageSelect.value = detectionLanguage;
            if (intervalInput) intervalInput.value = detectionInterval;
            if (confidenceSlider) {
                confidenceSlider.value = detectionConfidence;
                if (confidenceLabel) confidenceLabel.textContent = `${Math.round(detectionConfidence * 100)}%`;
            }
            if (backendSelect) backendSelect.value = screenshotBackend;

            // Auto-start detection if enabled
            if (enableMapDetection) {
                this.startContinuousDetection(false);
            }

        } catch (error) {
            console.error('Failed to load map detection settings:', error);
        }
    }

    // Add methods for detection functionality
    async performSingleDetection() {
        this.updateStatus('Performing single detection...', 'info');
        const language = document.getElementById('detectionLanguage')?.value || 'en';
        
        try {
            const creatorFilter = document.getElementById('mapCreatorFilter')?.value || '';
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
        
        if (result.processNotRunning) {
            // Process check is enabled but target process is not running
            alertDiv.className = 'alert alert-info';
            contentDiv.innerHTML = `
                <p><strong>Target Process Not Running</strong></p>
                <p>Detection paused - waiting for target process to start</p>
                <p><strong>Time:</strong> ${new Date().toLocaleTimeString()}</p>
            `;
        } else if (result.success && result.mapKey) {
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
                <p><strong>No Map Detected</strong></p>
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

    updateStatus(message, type) {
        const statusDiv = document.getElementById('detectionStatus');
        if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.className = `alert alert-${type}`;
            statusDiv.textContent = message;
        }
    }

    displayError(message) {
        this.updateStatus(message, 'danger');
    }
}

module.exports = MapDetectionUI;