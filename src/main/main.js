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
let ghostMistakeChance = 5; // Mistake chance %
let ghostMaxMistakes = 1; // Max consecutive mistakes

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

      // Register global shortcuts after window is ready
      // Small delay to ensure all systems are initialized
      setTimeout(() => {
        registerGlobalShortcut();
      }, 200);

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

  // Register Global Shortcuts will be called after app is ready (see app.whenReady below)

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

// Function to convert shortcut format from user-friendly to Electron format
// Converts "Ctrl+Alt+H" to "CommandOrControl+Alt+H"
function convertShortcutFormat(shortcut) {
  if (!shortcut) return shortcut;
  
  // If already in Electron format, return as-is
  if (shortcut.includes('CommandOrControl') || shortcut.includes('Control')) {
    return shortcut;
  }
  
  // Replace Ctrl with CommandOrControl (works on both Windows and macOS)
  let converted = shortcut.replace(/\bCtrl\b/gi, 'CommandOrControl');
  
  // Normalize key names - ensure single letter keys are uppercase
  const parts = converted.split('+');
  if (parts.length > 0) {
    const lastPart = parts[parts.length - 1];
    // If it's a single character, make it uppercase
    if (lastPart.length === 1 && /[a-z]/.test(lastPart)) {
      parts[parts.length - 1] = lastPart.toUpperCase();
      converted = parts.join('+');
    }
  }
  
  return converted;
}

// Function to register global shortcut
// Function to register global shortcuts
function registerGlobalShortcut() {
  globalShortcut.unregisterAll();

  // Helper function to safely register a shortcut
  const safeRegister = (shortcut, callback, description, fallbacks = []) => {
    try {
      // Convert shortcut format if needed
      const electronShortcut = convertShortcutFormat(shortcut);
      if (shortcut !== electronShortcut) {
        console.log(`Converting shortcut: "${shortcut}" -> "${electronShortcut}"`);
      }
      
      // Check if already registered by this app
      if (globalShortcut.isRegistered(electronShortcut)) {
        // Try to unregister first
        globalShortcut.unregister(electronShortcut);
      }
      
      const ret = globalShortcut.register(electronShortcut, callback);
      if (!ret) {
        console.warn(`Registration failed for shortcut: ${description || shortcut} (tried: ${electronShortcut})`);
        
        // Try fallback shortcuts if provided
        if (fallbacks && fallbacks.length > 0) {
          for (const fallback of fallbacks) {
            const fallbackShortcut = convertShortcutFormat(fallback);
            if (!globalShortcut.isRegistered(fallbackShortcut)) {
              const fallbackRet = globalShortcut.register(fallbackShortcut, callback);
              if (fallbackRet) {
                console.log(`✓ Using fallback shortcut: ${fallbackShortcut} for ${description || shortcut}`);
                return true;
              }
            }
          }
        }
        
        // Check if shortcut is already registered by another application
        if (globalShortcut.isRegistered(electronShortcut)) {
          console.warn(`  Note: Shortcut "${electronShortcut}" is already registered by another application`);
        }
        return false;
      } else {
        console.log(`✓ Global shortcut registered: ${description || shortcut} (${electronShortcut})`);
        return true;
      }
    } catch (error) {
      console.error(`Error registering shortcut ${description || shortcut}:`, error.message);
      return false;
    }
  };

  // Hide/Show Shortcut
  safeRegister(currentShortcut, () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  }, currentShortcut, ['CommandOrControl+Shift+H', 'CommandOrControl+Alt+Shift+H']);

  // Ghost Type Shortcut
  safeRegister(ghostTypeShortcut, () => {
    ghostTyper.typeClipboard(ghostWpm, ghostMistakeChance, ghostMaxMistakes);
  }, ghostTypeShortcut, ['CommandOrControl+Alt+Shift+V', 'CommandOrControl+Shift+V']);

  // Quit Shortcut
  safeRegister(quitShortcut, () => {
    console.log('Quit shortcut triggered, exiting...');
    app.quit();
  }, quitShortcut, ['CommandOrControl+Alt+Shift+Q', 'CommandOrControl+Shift+Q']);

  // Resize Window Shortcuts
  const resizeStep = 50;  // Resize by 50px each time

  // Increase size: Try multiple formats for the plus/equals key
  const plusFormats = [
    'CommandOrControl+Alt+Plus',
    'CommandOrControl+Alt+=',
    'CommandOrControl+Alt+Shift+='
  ];
  
  let plusRegistered = false;
  for (const format of plusFormats) {
    if (safeRegister(format, () => {
      console.log('Resize increase shortcut triggered');
      resizeWindow(resizeStep, resizeStep);
    }, `Ctrl+Alt+Plus (${format})`)) {
      plusRegistered = true;
      break;
    }
  }
  
  if (!plusRegistered) {
    console.error('All resize plus shortcut formats failed');
  }

  // Decrease size: Ctrl+Alt+- (minus key)
  safeRegister('CommandOrControl+Alt+-', () => {
    console.log('Resize decrease shortcut triggered');
    resizeWindow(-resizeStep, -resizeStep);
  }, 'Ctrl+Alt+-');

  // Position Window Shortcuts
  safeRegister('CommandOrControl+Alt+Left', () => {
    console.log('Move left shortcut triggered');
    moveWindow('left');
  }, 'Ctrl+Alt+Left');

  safeRegister('CommandOrControl+Alt+Right', () => {
    console.log('Move right shortcut triggered');
    moveWindow('right');
  }, 'Ctrl+Alt+Right');

  safeRegister('CommandOrControl+Alt+Up', () => {
    console.log('Move top shortcut triggered');
    moveWindow('top');
  }, 'Ctrl+Alt+Up');

  safeRegister('CommandOrControl+Alt+Down', () => {
    console.log('Move bottom shortcut triggered');
    moveWindow('bottom');
  }, 'Ctrl+Alt+Down');
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

ipcMain.handle('update-ghost-mistake-chance', async (event, chance) => {
  const newChance = parseInt(chance);
  if (!isNaN(newChance) && newChance >= 0 && newChance <= 100) {
    ghostMistakeChance = newChance;
    return true;
  }
  return false;
});

ipcMain.handle('update-ghost-max-mistakes', async (event, max) => {
  const newMax = parseInt(max);
  if (!isNaN(newMax) && newMax >= 1) {
    ghostMaxMistakes = newMax;
    return true;
  }
  return false;
});

// Clean up shortcuts
app.on('will-quit', () => {
  // Unregister all shortcuts.
  globalShortcut.unregisterAll();
});

