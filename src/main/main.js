/**
 * Main Electron Process
 * Application entry point and window management
 */

const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const windowManager = require('./window-manager');
const systemTray = require('./system-tray');
const ipcHandlers = require('./ipc-handlers');
const securityMonitor = require('./security-monitor');
const ghostTyper = require('./ghost-typer');

// Security: Disable remote module
app.allowRendererProcessReuse = true;

let mainWindow = null;
let sessionKey = null; // Encrypted session key (memory only)
let savedBounds = null; // Store window position/size when hidden
let currentShortcut = 'Ctrl+Alt+H'; // Hide shortcut
let ghostTypeShortcut = 'Ctrl+Alt+V'; // Ghost Type shortcut
let ghostWpm = 60; // Ghost WPM

/**
 * Create main application window
 */
function createWindow() {
  // Security: Configure BrowserWindow with secure defaults
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1a1a1a', // Dark background
    alwaysOnTop: true, // Always stay on top of all windows
    webPreferences: {
      nodeIntegration: false, // Security: No Node.js in renderer
      contextIsolation: true, // Security: Isolate context
      sandbox: false, // Disable sandbox to allow require in preload
      preload: path.join(__dirname, '../preload/preload.js'), // Preload script
      webSecurity: true, // Security: Enable web security
      allowRunningInsecureContent: false,
      webviewTag: true, // Enable webview tag for in-built browser
    },
    show: false, // Don't show until ready
    frame: false, // Frameless window
    titleBarStyle: 'hidden', // Hide title bar
    skipTaskbar: true, // Hide from taskbar
    icon: path.join(__dirname, '../../assets/icon.png') // Will be set if exists
  });

  // Security: Enable content protection (prevents screen sharing)
  mainWindow.setContentProtection(true);

  // Set always on top from config (default: true)
  mainWindow.setAlwaysOnTop(true);

  // Try to load config and apply always-on-top setting
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const { app } = require('electron');
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, '.config.enc');

    // Check if config exists (don't try to decrypt here, just check default)
    // Will be properly loaded after authentication
    // For now, default to always on top
  } catch (error) {
    // Ignore errors, use default
  }

  // Load HTML file
  mainWindow.loadFile(path.join(__dirname, '../index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      // Ensure always-on-top is enabled
      mainWindow.setAlwaysOnTop(true);
      mainWindow.focus();
    }
  });
  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      // Ensure always-on-top is enabled
      mainWindow.setAlwaysOnTop(true);
      mainWindow.focus();

      // Open DevTools in development (F12 or Ctrl+Shift+I)
      // if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
      //   // Open DevTools automatically in dev mode
      //   mainWindow.webContents.openDevTools();
      // }
    }
  });
  // Keyboard shortcut to toggle DevTools (F12 or Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Clear session key when window closes
    sessionKey = null;
  });

  // Handle window blur (for privacy features)
  mainWindow.on('blur', () => {
    if (mainWindow) {
      mainWindow.webContents.send('window-blurred');

      // Always ensure window stays on top
      // Re-apply always-on-top to ensure it stays active
      if (!mainWindow.isAlwaysOnTop()) {
        mainWindow.setAlwaysOnTop(true);
      }
    }
  });

  // Periodically ensure always-on-top is enabled
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isAlwaysOnTop()) {
        mainWindow.setAlwaysOnTop(true);
      }
    }
  }, 2000); // Check every 2 seconds

  // Handle window focus
  mainWindow.on('focus', () => {
    if (mainWindow) {
      mainWindow.webContents.send('window-focused');
      // Ensure always-on-top is enabled when window gains focus
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  // Register Global Shortcut
  registerGlobalShortcut();

  // Security: Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    if (parsedUrl.origin !== 'file://') {
      event.preventDefault();
    }
  });

  // Security: Prevent new window creation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Initialize window manager
  windowManager.initialize(mainWindow);

  // Register IPC handlers
  ipcHandlers.registerHandlers(mainWindow, () => sessionKey, (key) => {
    sessionKey = key;
  });

  // Setup hide/show with position saving
  const hideWindow = () => {
    if (mainWindow && mainWindow.isVisible()) {
      savedBounds = mainWindow.getBounds(); // Save position before hiding
      mainWindow.hide();
    }
  };

  const showWindow = () => {
    if (mainWindow) {
      if (savedBounds) {
        // Restore to saved position
        mainWindow.setBounds(savedBounds);
      }
      mainWindow.show();
      mainWindow.focus();
    }
  };

  const toggleWindow = () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        hideWindow();
      } else {
        showWindow();
      }
    }
  };

  // Store functions for use by system tray
  global.toggleWindow = toggleWindow;

  return mainWindow;
}

/**
 * Initialize application
 */
function initializeApp() {
  // Initialize system tray
  systemTray.createTray(() => {
    if (!mainWindow) {
      createWindow();
    } else {
      if (savedBounds) {
        mainWindow.setBounds(savedBounds);
      }
      mainWindow.show();
      mainWindow.focus();
    }
  }, () => {
    if (mainWindow && mainWindow.isVisible()) {
      savedBounds = mainWindow.getBounds();
      mainWindow.hide();
    }
  });

  // Register global shortcuts with CTRL+ALT+H
  systemTray.registerHotkeys(() => {
    if (typeof global.toggleWindow === 'function') {
      global.toggleWindow();
    } else if (mainWindow) {
      if (mainWindow.isVisible()) {
        savedBounds = mainWindow.getBounds();
        mainWindow.hide();
      } else {
        if (savedBounds) {
          mainWindow.setBounds(savedBounds);
        }
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });

  // Initialize security monitor
  securityMonitor.initialize();

  // Create window
  createWindow();
}

// App event handlers
app.whenReady().then(() => {
  initializeApp();

  // macOS: Recreate window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On Windows/Linux, quit when all windows are closed
  // On macOS, apps typically stay active
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Another instance was launched, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

// Security: Clear sensitive data on quit
app.on('before-quit', () => {
  sessionKey = null;
  securityMonitor.shutdown();
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  securityMonitor.logError(error);

  // Send to renderer for logging if window exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-error', {
      level: 'error',
      message: error.message || 'Uncaught exception',
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection:', reason);
  securityMonitor.logError(reason);

  // Send to renderer for logging if window exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-error', {
      level: 'error',
      message: `Unhandled rejection: ${reason}`,
      stack: reason?.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// Function to register global shortcut
// Function to register global shortcuts
function registerGlobalShortcut() {
  globalShortcut.unregisterAll();

  try {
    // Hide/Show Shortcut
    const ret = globalShortcut.register(currentShortcut, () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });

    if (!ret) {
      console.error('Registration failed for shortcut:', currentShortcut);
    } else {
      console.log('Global shortcut registered:', currentShortcut);
    }

    // Ghost Type Shortcut
    const retGhost = globalShortcut.register(ghostTypeShortcut, () => {
      ghostTyper.typeClipboard(ghostWpm);
    });

    if (!retGhost) {
      console.error('Registration failed for ghost shortcut:', ghostTypeShortcut);
    } else {
      console.log('Ghost Type shortcut registered:', ghostTypeShortcut);
    }

  } catch (error) {
    console.error('Error registering shortcuts:', error);
  }
}

// IPC to update shortcuts from renderer
ipcMain.handle('update-shortcut', async (event, newShortcut) => {
  if (!newShortcut) return false;
  currentShortcut = newShortcut;
  registerGlobalShortcut();
  return true;
});

ipcMain.handle('update-ghost-shortcut', async (event, newShortcut) => {
  if (!newShortcut) return false;
  ghostTypeShortcut = newShortcut;
  registerGlobalShortcut();
  return true;
});

ipcMain.handle('update-ghost-wpm', async (event, wpm) => {
  const newWpm = parseInt(wpm);
  if (!isNaN(newWpm) && newWpm > 0) {
    ghostWpm = newWpm;
    return true;
  }
  return false;
});

// Clean up shortcuts
app.on('will-quit', () => {
  // Unregister all shortcuts.
  globalShortcut.unregisterAll();
});

