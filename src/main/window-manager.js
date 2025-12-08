/**
 * Window Manager
 * Manages window state, position, and behavior
 */

const { screen } = require('electron');

let mainWindow = null;
let windowState = {
  width: 800,
  height: 600,
  x: undefined,
  y: undefined,
  isMaximized: false
};

/**
 * Initialize window manager
 * @param {BrowserWindow} window - Main window instance
 */
function initialize(window) {
  mainWindow = window;
  
  // Load saved window state
  loadWindowState();
  
  // Apply saved state
  if (windowState.x !== undefined && windowState.y !== undefined) {
    window.setPosition(windowState.x, windowState.y);
  }
  
  if (windowState.width && windowState.height) {
    window.setSize(windowState.width, windowState.height);
  }
  
  if (windowState.isMaximized) {
    window.maximize();
  }
  
  // Save state on window events
  window.on('moved', saveWindowState);
  window.on('resized', saveWindowState);
  window.on('maximize', () => {
    windowState.isMaximized = true;
    saveWindowState();
  });
  window.on('unmaximize', () => {
    windowState.isMaximized = false;
    saveWindowState();
  });
  
  // Handle multi-monitor scenarios
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);
}

/**
 * Load window state from storage
 */
function loadWindowState() {
  // For now, use defaults
  // In future, could load from encrypted config
  // This would require encryption key, so better to keep simple
  const defaultState = {
    width: 800,
    height: 600,
    x: undefined,
    y: undefined,
    isMaximized: false
  };
  
  windowState = { ...defaultState };
  
  // Center window on primary display if no position saved
  if (windowState.x === undefined || windowState.y === undefined) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    
    windowState.x = Math.floor((width - windowState.width) / 2);
    windowState.y = Math.floor((height - windowState.height) / 2);
  }
}

/**
 * Save window state
 */
function saveWindowState() {
  if (!mainWindow) return;
  
  if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
    const bounds = mainWindow.getBounds();
    windowState.width = bounds.width;
    windowState.height = bounds.height;
    windowState.x = bounds.x;
    windowState.y = bounds.y;
  }
  
  windowState.isMaximized = mainWindow.isMaximized();
  
  // In future, could save to encrypted config
  // For now, state is session-only
}

/**
 * Handle display changes (multi-monitor)
 */
function handleDisplayChange() {
  if (!mainWindow) return;
  
  // Check if window is still on a valid display
  const displays = screen.getAllDisplays();
  const bounds = mainWindow.getBounds();
  
  let isOnValidDisplay = false;
  for (const display of displays) {
    const { x, y, width, height } = display.bounds;
    if (
      bounds.x >= x && bounds.x < x + width &&
      bounds.y >= y && bounds.y < y + height
    ) {
      isOnValidDisplay = true;
      break;
    }
  }
  
  // If window is on invalid display, move to primary
  if (!isOnValidDisplay && displays.length > 0) {
    const primaryDisplay = displays.find(d => d.id === screen.getPrimaryDisplay().id) || displays[0];
    const { width, height } = primaryDisplay.workAreaSize;
    
    const newX = Math.floor((width - bounds.width) / 2);
    const newY = Math.floor((height - bounds.height) / 2);
    
    mainWindow.setPosition(newX, newY);
  }
}

/**
 * Get current window state
 * @returns {Object} Window state
 */
function getWindowState() {
  return { ...windowState };
}

module.exports = {
  initialize,
  getWindowState,
  saveWindowState
};

