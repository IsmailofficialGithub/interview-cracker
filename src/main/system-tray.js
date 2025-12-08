/**
 * System Tray Module
 * System tray icon and menu
 */

const { Tray, Menu, globalShortcut, app } = require('electron');
const path = require('path');

let tray = null;
let showCallback = null;
let hideCallback = null;

/**
 * Create system tray icon
 * @param {Function} onShow - Callback when show is clicked
 * @param {Function} onHide - Callback when hide is clicked
 */
function createTray(onShow, onHide) {
  showCallback = onShow;
  hideCallback = onHide;
  
  // Use a simple icon (in production, provide actual icon file)
  // For now, use app icon or default
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  
  // Create tray (will use default icon if file doesn't exist)
  try {
    tray = new Tray(iconPath);
  } catch (error) {
    // Fallback: create tray with no icon (will show default)
    tray = new Tray(path.join(__dirname, '../../assets/icon.png'));
  }
  
  tray.setToolTip('Private AI Chat');
  
  // Create context menu
  updateMenu();
  
  // Handle click (Windows/Linux)
  tray.on('click', () => {
    if (showCallback) {
      showCallback();
    }
  });
}

/**
 * Update tray menu
 */
function updateMenu() {
  if (!tray) return;
  
  const menu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (showCallback) {
          showCallback();
        }
      }
    },
    {
      label: 'Hide',
      click: () => {
        if (hideCallback) {
          hideCallback();
        }
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(menu);
}

/**
 * Register global hotkeys
 * @param {Function} toggleCallback - Callback for hide/show toggle
 */
function registerHotkeys(toggleCallback) {
  // Register CTRL+ALT+H for hide/show (more distinctive, less conflicts)
  const ret = globalShortcut.register('CommandOrControl+Alt+H', () => {
    if (toggleCallback) {
      toggleCallback();
    }
  });
  
  if (!ret) {
    console.error('Failed to register global shortcut CTRL+ALT+H');
    // Fallback to CTRL+SHIFT+H if CTRL+ALT+H fails
    const ret2 = globalShortcut.register('CommandOrControl+Shift+H', () => {
      if (toggleCallback) {
        toggleCallback();
      }
    });
    if (!ret2) {
      console.error('Failed to register fallback shortcut');
    }
  }
  
  // Unregister on app quit
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

/**
 * Destroy system tray
 */
function destroy() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = {
  createTray,
  updateMenu,
  registerHotkeys,
  destroy
};

