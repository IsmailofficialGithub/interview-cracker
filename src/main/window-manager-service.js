/**
 * Window Manager Service
 * Manages native window embedding using Win32 API
 */

const path = require('path');

let nativeAddon = null;
let mainWindow = null;
let electronWindowHandle = null;
const embeddedWindows = new Map(); // tabId -> { hwnd, processId, appName, visible, processHandle }

// Load native addon
function loadNativeAddon() {
  try {
    // Try to load from native build directory
    const addonPath = path.join(__dirname, '../../native/build/Release/window-manager.node');
    nativeAddon = require(addonPath);
    return true;
  } catch (error) {
    console.error('Failed to load native addon:', error);
    console.error('Make sure to run: npm run rebuild');
    return false;
  }
}

/**
 * Initialize window manager service
 * @param {BrowserWindow} window - Electron main window
 */
function initialize(window) {
  mainWindow = window;

  // Get Electron window's native handle
  try {
    const hwnd = mainWindow.getNativeWindowHandle();
    if (Buffer.isBuffer(hwnd)) {
      // Read as BigInt for 64-bit Windows
      electronWindowHandle = Number(hwnd.readBigUInt64LE(0));
    } else if (typeof hwnd === 'bigint') {
      electronWindowHandle = Number(hwnd);
    } else {
      electronWindowHandle = Number(hwnd) || hwnd;
    }
  } catch (e) {
    console.error('Failed to get window handle:', e);
    throw new Error('Cannot get Electron window handle. Window embedding requires a valid window handle.');
  }

  // Load native addon
  if (!loadNativeAddon()) {
    throw new Error('Failed to load native window manager addon');
  }

  console.log('Window Manager Service initialized');
}

/**
 * Launch application and embed it
 * @param {string} appPath - Path to executable
 * @param {string} tabId - Unique tab identifier
 * @returns {Promise<Object>} Result with hwnd and processId
 */
async function launchAndEmbed(appPath, tabId) {
  if (!nativeAddon) {
    throw new Error('Native addon not loaded');
  }

  if (!electronWindowHandle) {
    throw new Error('Electron window handle not available');
  }

  // Launch application (with timeout handled in C++)
  const launchResult = nativeAddon.launchApplication(appPath, electronWindowHandle);

  if (!launchResult.success) {
    // Check for specific error types
    const errorMsg = launchResult.error || 'Failed to launch application';
    if (errorMsg.includes('Window not found')) {
      throw new Error('Application launched but window not found. The app may have a delayed startup or requires user interaction.');
    } else if (errorMsg.includes('Failed to launch process')) {
      throw new Error('Failed to start the application. Check if the path is correct and you have permission to run it.');
    }
    throw new Error(errorMsg);
  }

  const { processId, processHandle } = launchResult;
  let hwnd = null;

  console.log(`[WindowManager] Waiting for window of process ${processId}...`);

  // Poll for window (max 30 seconds)
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      // Check if native addon has the new function
      if (typeof nativeAddon.getMainWindow === 'function') {
        const windowResult = nativeAddon.getMainWindow(processId);
        if (windowResult.success && windowResult.hwnd) {
          hwnd = windowResult.hwnd;
          console.log(`[WindowManager] Found window: ${hwnd}`);
          break;
        }
      } else {
        // Fallback or error if function missing (shouldn't happen if rebuilt)
        throw new Error('Native addon missing getMainWindow function');
      }
    } catch (e) {
      console.warn(`[WindowManager] Error checking window: ${e.message}`);
    }
  }

  if (!hwnd) {
    try {
      nativeAddon.terminateProcess(processId);
    } catch (e) { }
    throw new Error('Application launched but window not found within 30 seconds. The app may be minimized to tray or running in background.');
  }

  // Calculate embedded window area (account for sidebar, tabs, header)
  const sidebarWidth = 300;
  const tabBarHeight = 36;
  const headerHeight = 50;
  const bounds = mainWindow.getBounds();
  const x = sidebarWidth;
  const y = headerHeight + tabBarHeight;
  const width = bounds.width - sidebarWidth;
  const height = bounds.height - headerHeight - tabBarHeight;

  // Longer delay to let window fully initialize before embedding
  // Some apps need more time to stabilize
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify window still exists and is ready before embedding
  try {
    const checkInfo = nativeAddon.getWindowInfo(hwnd);
    if (!checkInfo.success) {
      throw new Error('Window not ready for embedding');
    }
    console.log(`[WindowManager] Preparing to embed: ${checkInfo.title || 'Unknown'} (PID: ${processId})`);
  } catch (e) {
    try {
      nativeAddon.terminateProcess(processId);
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }
    throw new Error('Window disappeared before embedding. The app may have closed itself.');
  }

  // Embed window
  console.log(`[WindowManager] Embedding window at position (${x}, ${y}) size ${width}x${height}`);
  const embedResult = nativeAddon.embedWindow(
    hwnd,
    electronWindowHandle,
    x, y,
    width, height
  );

  if (!embedResult.success) {
    console.error(`[WindowManager] Embed failed: ${embedResult.error}`);
    // Cleanup on failure
    try {
      nativeAddon.terminateProcess(processId);
    } catch (e) {
      // Ignore cleanup errors
    }
    throw new Error(embedResult.error || 'Failed to embed window');
  }

  console.log(`[WindowManager] Window embedded successfully`);

  // Verify window still exists after embedding with multiple checks
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      const postEmbedInfo = nativeAddon.getWindowInfo(hwnd);
      if (!postEmbedInfo.success) {
        console.warn(`[WindowManager] Window disappeared after embedding (check ${i + 1}/3)`);
        if (i === 2) {
          // Final check failed - window is gone
          embeddedWindows.delete(tabId);
          throw new Error('The application closed itself after embedding. This app does not support window embedding.');
        }
      } else {
        console.log(`[WindowManager] Window verified after embedding: ${postEmbedInfo.title}`);
        break; // Window is still valid
      }
    } catch (e) {
      if (i === 2) {
        // Final check failed
        embeddedWindows.delete(tabId);
        throw new Error('The application closed itself after embedding. Some apps have security restrictions that prevent embedding.');
      }
    }
  }

  // Get window info for app name
  const windowInfo = nativeAddon.getWindowInfo(hwnd);
  const appName = windowInfo.title || path.basename(appPath, '.exe');

  // Store in tracking map
  embeddedWindows.set(tabId, {
    hwnd,
    processId,
    appName,
    visible: true,
    processHandle: processHandle || null
  });

  return {
    success: true,
    hwnd,
    processId,
    appName
  };
}

/**
 * Show embedded window (make tab active)
 * @param {string} tabId - Tab identifier
 */
function showTab(tabId) {
  const windowData = embeddedWindows.get(tabId);
  if (!windowData) {
    throw new Error(`Window not found for tab: ${tabId}`);
  }

  if (!nativeAddon) {
    throw new Error('Native addon not loaded');
  }

  const result = nativeAddon.showWindow(windowData.hwnd, true);
  if (result.success) {
    windowData.visible = true;
    // Bring to front
    try {
      nativeAddon.resizeWindow(
        windowData.hwnd,
        windowData.x || 300,
        windowData.y || 86,
        windowData.width || 500,
        windowData.height || 514
      );
    } catch (e) {
      // Ignore resize errors
    }
  }

  return result;
}

/**
 * Hide embedded window (make tab inactive)
 * @param {string} tabId - Tab identifier
 */
function hideTab(tabId) {
  const windowData = embeddedWindows.get(tabId);
  if (!windowData) {
    throw new Error(`Window not found for tab: ${tabId}`);
  }

  if (!nativeAddon) {
    throw new Error('Native addon not loaded');
  }

  const result = nativeAddon.showWindow(windowData.hwnd, false);
  if (result.success) {
    windowData.visible = false;
  }

  return result;
}

/**
 * Close tab and cleanup
 * @param {string} tabId - Tab identifier
 */
function closeTab(tabId) {
  const windowData = embeddedWindows.get(tabId);
  if (!windowData) {
    return { success: false, error: `Window not found for tab: ${tabId}` };
  }

  if (!nativeAddon) {
    return { success: false, error: 'Native addon not loaded' };
  }

  try {
    // Unparent window first
    nativeAddon.unparentWindow(windowData.hwnd);
  } catch (e) {
    console.warn('Failed to unparent window:', e);
  }

  try {
    // Terminate process
    const result = nativeAddon.terminateProcess(windowData.processId);
    if (!result.success) {
      console.warn('Failed to terminate process:', result.error);
    }
  } catch (e) {
    console.warn('Error terminating process:', e);
  }

  // Remove from tracking
  embeddedWindows.delete(tabId);

  return { success: true };
}

/**
 * Resize all embedded windows
 * @param {number} width - New width
 * @param {number} height - New height
 */
function resizeAllWindows(width, height) {
  if (!nativeAddon) return;

  const sidebarWidth = 300;
  const tabBarHeight = 36;
  const headerHeight = 50;
  const x = sidebarWidth;
  const y = headerHeight + tabBarHeight;
  const windowWidth = width - sidebarWidth;
  const windowHeight = height - headerHeight - tabBarHeight;

  embeddedWindows.forEach((windowData, tabId) => {
    if (windowData.visible) {
      try {
        nativeAddon.resizeWindow(
          windowData.hwnd,
          x, y,
          windowWidth, windowHeight
        );
        // Store dimensions
        windowData.x = x;
        windowData.y = y;
        windowData.width = windowWidth;
        windowData.height = windowHeight;
      } catch (e) {
        console.warn(`Failed to resize window for tab ${tabId}:`, e);
      }
    }
  });
}

/**
 * Resize specific embedded window
 * @param {string} tabId - Tab identifier
 * @param {number} width - New width
 * @param {number} height - New height
 */
function resizeWindow(tabId, width, height) {
  const windowData = embeddedWindows.get(tabId);
  if (!windowData) {
    throw new Error(`Window not found for tab: ${tabId}`);
  }

  if (!nativeAddon) {
    throw new Error('Native addon not loaded');
  }

  const sidebarWidth = 300;
  const tabBarHeight = 36;
  const headerHeight = 50;
  const x = sidebarWidth;
  const y = headerHeight + tabBarHeight;

  const result = nativeAddon.resizeWindow(
    windowData.hwnd,
    x, y,
    width, height
  );

  if (result.success) {
    windowData.x = x;
    windowData.y = y;
    windowData.width = width;
    windowData.height = height;
  }

  return result;
}

/**
 * Move embedded window to new position
 * @param {string} tabId - Tab identifier
 * @param {number} x - New x position
 * @param {number} y - New y position
 */
function moveWindow(tabId, x, y) {
  const windowData = embeddedWindows.get(tabId);
  if (!windowData) {
    throw new Error(`Window not found for tab: ${tabId}`);
  }

  if (!nativeAddon) {
    throw new Error('Native addon not loaded');
  }

  const result = nativeAddon.moveWindow(
    windowData.hwnd,
    x, y
  );

  if (result.success) {
    windowData.x = x;
    windowData.y = y;
  }

  return result;
}

/**
 * Get Electron window handle
 * @returns {number} Window handle
 */
function getWindowHandle() {
  return electronWindowHandle;
}

/**
 * Get all embedded windows
 * @returns {Map} Map of embedded windows
 */
function getEmbeddedWindows() {
  return embeddedWindows;
}

/**
 * Monitor processes for crashes
 */
function monitorProcesses() {
  if (!nativeAddon) return;

  embeddedWindows.forEach((windowData, tabId) => {
    try {
      // Check if window still exists
      const windowInfo = nativeAddon.getWindowInfo(windowData.hwnd);
      if (!windowInfo.success) {
        // Window disappeared - process likely crashed or app closed itself
        console.warn(`Window for tab ${tabId} disappeared, cleaning up`);
        embeddedWindows.delete(tabId);
        // Notify renderer via IPC event
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('embedded-window-closed', {
            tabId,
            reason: 'window_closed'
          });
        }
      }
    } catch (e) {
      // Error checking window - might be closed
      console.warn(`Error checking window for tab ${tabId}:`, e);
      embeddedWindows.delete(tabId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('embedded-window-closed', {
          tabId,
          reason: 'error_checking'
        });
      }
    }
  });
}

/**
 * Cleanup all embedded windows on app quit
 */
function cleanupAll() {
  const tabIds = Array.from(embeddedWindows.keys());
  tabIds.forEach(tabId => {
    closeTab(tabId);
  });
  embeddedWindows.clear();
}

module.exports = {
  initialize,
  launchAndEmbed,
  showTab,
  hideTab,
  closeTab,
  resizeAllWindows,
  resizeWindow,
  moveWindow,
  getWindowHandle,
  getEmbeddedWindows,
  monitorProcesses,
  cleanupAll
};

