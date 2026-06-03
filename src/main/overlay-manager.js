/**
 * Overlay Manager
 * Manages the transparent OCR overlay window
 */

const { BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

let overlayWindow = null;

/**
 * Create the overlay window
 */
function createOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.focus();
    return overlayWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 400,
    height: 300,
    x: Math.floor(width / 2) - 200,
    y: Math.floor(height / 2) - 150,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/preload.js')
    }
  });

  // Security: Hide window from screen sharing/capture
  overlayWindow.setContentProtection(true);

  // Load the overlay HTML
  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));

  // Handle window closed
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

/**
 * Toggle the overlay window
 */
function toggleOverlay() {
  if (overlayWindow) {
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.show();
      overlayWindow.focus();
    }
  } else {
    createOverlayWindow();
  }
  
  // Notify main window
  const { webContents } = require('electron');
  webContents.getAllWebContents().forEach(wc => {
    wc.send('overlay-state-changed', { visible: overlayWindow ? overlayWindow.isVisible() : false });
  });
}

/**
 * Set the click-through state of the overlay
 * @param {boolean} ignore - If true, mouse events pass through
 */
function setIgnoreMouseEvents(ignore, options = { forward: true }) {
  if (overlayWindow) {
    overlayWindow.setIgnoreMouseEvents(ignore, options);
  }
}

/**
 * Initialize IPC handlers for overlay
 */
function initialize() {
  ipcMain.handle('toggle-overlay', () => {
    toggleOverlay();
    return { success: true, visible: overlayWindow ? overlayWindow.isVisible() : false };
  });

  ipcMain.handle('set-overlay-ignore-mouse', (event, ignore) => {
    setIgnoreMouseEvents(ignore);
    return { success: true };
  });

  ipcMain.handle('get-overlay-bounds', () => {
    if (overlayWindow) {
      return { success: true, bounds: overlayWindow.getBounds() };
    }
    return { success: false, error: 'Overlay window not active' };
  });

  ipcMain.handle('set-overlay-bounds', (event, bounds) => {
    if (overlayWindow) {
      overlayWindow.setBounds(bounds);
      return { success: true };
    }
    return { success: false, error: 'Overlay window not active' };
  });

  ipcMain.handle('capture-overlay-area', async (event, bounds) => {
    try {
      const display = screen.getDisplayMatching(bounds);

      // FALLBACK: Use native Windows capture if possible (advanced bypass)
      // For now, we'll stick to high-res desktopCapturer but with a safer source selection
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.floor(display.size.width * display.scaleFactor),
          height: Math.floor(display.size.height * display.scaleFactor)
        }
      });

      // Filter sources to find the one matching our display
      const source = sources.find(s => s.id.includes(display.id.toString())) || sources[0];

      let finalDataUrl;
      if (source) {
        finalDataUrl = source.thumbnail.toDataURL();
      } else if (process.platform === 'win32') {
        // Fallback to PowerShell screenshot
        const tempPath = path.join(os.tmpdir(), 'screen_capture.png');
        execSync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen; $bitmap = New-Object System.Drawing.Bitmap $screen.Bounds.Width, $screen.Bounds.Height; $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size); $bitmap.Save('${tempPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)"`);
        const bitmap = fs.readFileSync(tempPath);
        finalDataUrl = `data:image/png;base64,${bitmap.toString('base64')}`;
        fs.unlinkSync(tempPath);
      } else {
        throw new Error('No screen source found');
      }

      return {
        success: true,
        image: finalDataUrl,
        bounds: bounds,
        scaleFactor: display.scaleFactor
      };
    } catch (error) {
      console.error('Capture failed:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  initialize,
  toggleOverlay,
  createOverlayWindow,
  setIgnoreMouseEvents
};
