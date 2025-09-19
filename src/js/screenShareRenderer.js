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
        this.registerIpcListeners();
    }

    async startCapture() {
        this.stream = await navigator.mediaDevices.getDisplayMedia({
            video: { mediaSource: 'screen' },
            audio: false
        });

        this.videoElement.srcObject = this.stream;
        this.showStatus('Screen capture started successfully!');
    }

    stopCapture() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.videoElement.srcObject = null;
            this.stream = null;
            this.showStatus('Screen capture stopped.');
        }
    }

    registerIpcListeners() {
        ipcRenderer.on('take-stream-screenshot', async () => {
            console.log("Taking stream screenshot...")
            return await this.takeScreenshot()
        });
    }

    showStatus(message) {
        console.log(message);
    }


    async takeScreenshot(saveToDisk = false) {
        if (!this.videoElement || !this.stream) {
            this.showStatus('Please start screen capture first!');
            return null;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = this.videoElement.videoWidth;
        canvas.height = this.videoElement.videoHeight;
        
        ctx.drawImage(this.videoElement, 0, 0);
        
        if (saveToDisk) {
            this.saveScreenshotToDisk(canvas);
            return null;
        } else {
            let returnValue = await this.getScreenshotBuffer(canvas);
            return returnValue;
        }
    }

    getScreenshotBuffer(canvas = null) {
        if (!canvas) {
            if (!this.videoElement || !this.stream) {
                this.showStatus('Please start screen capture first!');
                return null;
            }
            
            canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = this.videoElement.videoWidth;
            canvas.height = this.videoElement.videoHeight;
            ctx.drawImage(this.videoElement, 0, 0);
        }
        
        // Return buffer that Jimp can read
        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                const reader = new FileReader();
                reader.onload = () => resolve(Buffer.from(reader.result));
                reader.readAsArrayBuffer(blob);
            }, 'image/png');
        });
    }

    saveScreenshotToDisk(canvas = null) {
        if (!canvas) {
            if (!this.videoElement || !this.stream) {
                this.showStatus('Please start screen capture first!');
                return;
            }
            
            canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = this.videoElement.videoWidth;
            canvas.height = this.videoElement.videoHeight;
            ctx.drawImage(this.videoElement, 0, 0);
        }
        
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `screenshot-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            this.showStatus('Screenshot saved to downloads!');
        }, 'image/png');
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