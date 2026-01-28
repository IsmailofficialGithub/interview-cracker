/**
 * Main Electron Process
 * Application entry point and window management
 */

const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const windowManager = require('./window-manager');
const systemTray = require('./system-tray');
const ipcHandlers = require('./ipc-handlers');
const securityMonitor = require('./security-monitor');
const ghostTyper = require('./ghost-typer');
const windowManagerService = require('./window-manager-service');
const appDiscoveryService = require('./app-discovery-service');

// Security: Disable remote module
app.allowRendererProcessReuse = true;

let mainWindow = null;
let sessionKey = null; // Encrypted session key (memory only)
let savedBounds = null; // Store window position/size when hidden
let currentShortcut = 'Ctrl+Alt+H'; // Hide shortcut
let ghostTypeShortcut = 'Ctrl+Alt+V'; // Ghost Type shortcut
let quitShortcut = 'Ctrl+Alt+Q'; // Quit shortcut
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
    resizable: false, // Prevent drag resizing and cursor changes
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
    frame: false, // No window frame (no title bar)
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
      // Ensure window is not resizable (prevent drag resizing)
      mainWindow.setResizable(false);
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

  // Initialize desktop app embedding services (Windows only)
  if (process.platform === 'win32') {
    try {
      windowManagerService.initialize(mainWindow);
      appDiscoveryService.initialize();
      
      // Hook window resize events
      mainWindow.on('resize', () => {
        const bounds = mainWindow.getBounds();
        windowManagerService.resizeAllWindows(bounds.width, bounds.height);
      });
      
      // Monitor processes periodically
      setInterval(() => {
        windowManagerService.monitorProcesses();
      }, 5000); // Check every 5 seconds
    } catch (error) {
      console.error('Failed to initialize desktop app embedding services:', error);
    }
  }

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
  
  // Cleanup embedded windows
  if (process.platform === 'win32') {
    try {
      windowManagerService.cleanupAll();
    } catch (error) {
      console.error('Error cleaning up embedded windows:', error);
    }
  }
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

/**
 * Resize window by a fixed amount
 * @param {number} deltaWidth - Change in width (positive = increase, negative = decrease)
 * @param {number} deltaHeight - Change in height (positive = increase, negative = decrease)
 */
function resizeWindow(deltaWidth, deltaHeight) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.error('Cannot resize: window is null or destroyed');
    return;
  }
  
  console.log(`Resizing window by ${deltaWidth}x${deltaHeight}`);
  
  // Temporarily enable resizing for programmatic changes
  mainWindow.setResizable(true);
  
  const bounds = mainWindow.getBounds();
  const newWidth = Math.max(400, bounds.width + deltaWidth);  // Minimum 400px
  const newHeight = Math.max(300, bounds.height + deltaHeight);  // Minimum 300px
  
  console.log(`Setting window size to ${newWidth}x${newHeight} (was ${bounds.width}x${bounds.height})`);
  mainWindow.setSize(newWidth, newHeight);
  
  // Notify renderer about resize for responsive scaling
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('window-resized', { width: newWidth, height: newHeight });
  }
  
  // Disable resizing again after change
  mainWindow.setResizable(false);
  console.log('Window resize complete');
}

/**
 * Move window incrementally in a specific direction
 * @param {string} direction - 'left', 'right', 'top', 'bottom'
 */
function moveWindow(direction) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.error('Cannot move: window is null or destroyed');
    return;
  }
  
  const moveStep = 50;  // Move by 50px each time
  const bounds = mainWindow.getBounds();
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;  // Work area excludes taskbar
  
  let newX = bounds.x;
  let newY = bounds.y;
  
  switch (direction) {
    case 'left':
      newX = Math.max(workArea.x, bounds.x - moveStep);
      break;
    case 'right':
      // Ensure window doesn't go beyond right edge
      const maxRight = workArea.x + workArea.width - bounds.width;
      newX = Math.min(maxRight, bounds.x + moveStep);
      break;
    case 'top':
      newY = Math.max(workArea.y, bounds.y - moveStep);
      break;
    case 'bottom':
      // Ensure window doesn't go beyond bottom edge
      const maxBottom = workArea.y + workArea.height - bounds.height;
      newY = Math.min(maxBottom, bounds.y + moveStep);
      break;
    default:
      console.error(`Invalid direction: ${direction}`);
      return;
  }
  
  console.log(`Moving window from (${bounds.x}, ${bounds.y}) to (${newX}, ${newY})`);
  mainWindow.setPosition(newX, newY);
  console.log('Window move complete');
}

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

    // Quit Shortcut
    const retQuit = globalShortcut.register(quitShortcut, () => {
      console.log('Quit shortcut triggered, exiting...');
      app.quit();
    });

    if (!retQuit) {
      console.error('Registration failed for quit shortcut:', quitShortcut);
    } else {
      console.log('Quit shortcut registered:', quitShortcut);
    }

    // Resize Window Shortcuts
    const resizeStep = 50;  // Resize by 50px each time

    // Increase size: Ctrl+Alt+= (equals key, which is + on most keyboards)
    const retResizePlus = globalShortcut.register('CommandOrControl+Alt+=', () => {
      console.log('Resize increase shortcut triggered');
      resizeWindow(resizeStep, resizeStep);
    });

    if (!retResizePlus) {
      console.error('Registration failed for resize plus shortcut (Ctrl+Alt+=)');
      // Try alternative: NumpadAdd
      const retAlt = globalShortcut.register('CommandOrControl+Alt+NumpadAdd', () => {
        console.log('Resize increase shortcut triggered (numpad)');
        resizeWindow(resizeStep, resizeStep);
      });
      if (!retAlt) {
        console.error('Alternative resize plus shortcut also failed');
      }
    } else {
      console.log('Resize increase shortcut registered: Ctrl+Alt+=');
    }

    // Decrease size: Ctrl+Alt+- (minus key)
    const retResizeMinus = globalShortcut.register('CommandOrControl+Alt+-', () => {
      console.log('Resize decrease shortcut triggered');
      resizeWindow(-resizeStep, -resizeStep);
    });

    if (!retResizeMinus) {
      console.error('Registration failed for resize minus shortcut');
    } else {
      console.log('Resize decrease shortcut registered: Ctrl+Alt+-');
    }

    // Position Window Shortcuts
    // Move left: Ctrl+Alt+Left
    const retMoveLeft = globalShortcut.register('CommandOrControl+Alt+Left', () => {
      console.log('Move left shortcut triggered');
      moveWindow('left');
    });

    // Move right: Ctrl+Alt+Right
    const retMoveRight = globalShortcut.register('CommandOrControl+Alt+Right', () => {
      console.log('Move right shortcut triggered');
      moveWindow('right');
    });

    // Move top: Ctrl+Alt+Up
    const retMoveTop = globalShortcut.register('CommandOrControl+Alt+Up', () => {
      console.log('Move top shortcut triggered');
      moveWindow('top');
    });

    // Move bottom: Ctrl+Alt+Down
    const retMoveBottom = globalShortcut.register('CommandOrControl+Alt+Down', () => {
      console.log('Move bottom shortcut triggered');
      moveWindow('bottom');
    });

    if (!retMoveLeft) {
      console.error('Registration failed for move left shortcut');
    } else {
      console.log('Move left shortcut registered: Ctrl+Alt+Left');
    }
    
    if (!retMoveRight) {
      console.error('Registration failed for move right shortcut');
    } else {
      console.log('Move right shortcut registered: Ctrl+Alt+Right');
    }
    
    if (!retMoveTop) {
      console.error('Registration failed for move top shortcut');
    } else {
      console.log('Move top shortcut registered: Ctrl+Alt+Up');
    }
    
    if (!retMoveBottom) {
      console.error('Registration failed for move bottom shortcut');
    } else {
      console.log('Move bottom shortcut registered: Ctrl+Alt+Down');
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

ipcMain.handle('update-quit-shortcut', async (event, newShortcut) => {
  if (!newShortcut) return false;
  quitShortcut = newShortcut;
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

