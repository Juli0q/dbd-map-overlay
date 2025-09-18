const {ipcRenderer} = require("electron");
const {debugLog} = require("./logger");

class ScreenShareRenderer {
    constructor() {
        debugLog("screenShareRenderer::constructor::called");
        this.videoElement = null;
        this.stream = null;
        this.screenshotPreview = null;
        this.init()
        this.screenshotInfo = null;
    }

    async init() {
        console.log("screenShareRenderer::init::called");
        this.videoElement = document.querySelector('video');
        this.screenshotPreview = document.getElementById('screenshotPreview');
    }

    async startCapture() {
        try {
            this.stream = await navigator.mediaDevices.getDisplayMedia({
                video: { mediaSource: 'screen' },
                audio: false
            });

            this.videoElement.srcObject = this.stream;
            this.showStatus('Screen capture started successfully!');
        } catch (error) {
            console.error('Error starting capture:', error);
            this.showStatus('Failed to start screen capture. Please try again.');
        }
    }

    stopCapture() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.videoElement.srcObject = null;
            this.stream = null;
            this.showStatus('Screen capture stopped.');
        }
    }

    takeScreenshot() {
        if (!this.videoElement || !this.stream) {
            this.showStatus('Please start screen capture first!');
            return;
        }

        if (this.videoElement.videoWidth === 0 || this.videoElement.videoHeight === 0) {
            this.showStatus('Video not ready yet. Try again in a moment.');
            return;
        }

        try {
            // Create canvas to capture video frame
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Set canvas dimensions to match video
            canvas.width = this.videoElement.videoWidth;
            canvas.height = this.videoElement.videoHeight;

            // Draw current video frame to canvas
            ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);

            // Convert to data URL
            const dataURL = canvas.toDataURL('image/png');

            // Show preview
            this.screenshotPreview.src = dataURL;

            // Save the screenshot
            this.saveScreenshot(dataURL);
        } catch (error) {
            console.error('Error taking screenshot:', error);
            this.showStatus('Failed to take screenshot. Please try again.');
        }
    }

    // Save screenshot using IPC to main process
    async saveScreenshot(dataURL) {
        try {
            const { ipcRenderer } = require('electron');
            this.showStatus('Saving screenshot...');
            const result = await ipcRenderer.invoke('save-screenshot', { dataURL });
            if (result.success) {
                this.lastSavedPath = result.filePath;
                this.showStatus(`Screenshot saved: ${result.filePath}`);
            } else {
                this.showStatus('Save failed: ' + result.error);
            }
        } catch (e) {
            console.error('IPC save error:', e);
            this.showStatus('Unable to save screenshot.');
        }
    }
}

module.exports = ScreenShareRenderer;