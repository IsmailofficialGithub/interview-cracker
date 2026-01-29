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
    try {
      tray = new Tray(path.join(__dirname, '../../assets/icon.png'));
    } catch (e) {
      console.error('Failed to create tray icon:', e);
      // Create empty tray (might show system default or empty space)
      // Note: On Windows, a tray icon is required effectively
    }
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
 * @deprecated Shortcuts are now registered in main.js via registerGlobalShortcut()
 * This function is kept for backwards compatibility but does nothing
 */
function registerHotkeys(toggleCallback) {
  // Shortcuts are now handled by main.js's registerGlobalShortcut()
  // This function is kept to avoid breaking existing code but does nothing
  console.log('registerHotkeys called - shortcuts are handled by main.js');
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

