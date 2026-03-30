/**
 * Auto-Updater Module
 * Handles application updates using electron-updater
 */

const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');
const semver = require('semver');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');


// Configure autoUpdater
autoUpdater.autoDownload = false; // We want to show UI before downloading
autoUpdater.allowPrerelease = false;

// Mock remote version URL for version-controlled logic
// In production, this would be your Supabase or API endpoint
const REMOTE_VERSION_URL = 'https://raw.githubusercontent.com/IsmailofficialGithub/interview-cracker/main/version.json';

let mainWindow = null;

/**
 * Initialize auto-updater
 * @param {BrowserWindow} window - The main application window
 */
function initialize(window) {
  mainWindow = window;

  // Logging Setup
  const logPath = path.join(app.getPath('userData'), 'update-error.log');
  
  function logToFile(msg, error = null) {
    const timestamp = new Date().toISOString();
    const errorDetails = error ? `\nStack: ${error.stack || error}` : '';
    const logEntry = `[${timestamp}] ${msg}${errorDetails}\n\n`;
    
    try {
      fs.appendFileSync(logPath, logEntry);
      console.log(`[AutoUpdater] Logged error to: ${logPath}`);
    } catch (e) {
      console.error('[AutoUpdater] Failed to write to log file:', e);
    }
  }

  // Logging
  autoUpdater.logger = console;
  console.log('[AutoUpdater] Initialized');

  // Check for updates periodically
  setInterval(() => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdates().catch(err => console.error('AutoUpdate check error:', err));
    }
  }, 1000 * 60 * 60 * 2); // Every 2 hours

  // Event: Update available
  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    mainWindow.webContents.send('update-available', info);
  });

  // Event: No update available
  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] No update available');
    mainWindow.webContents.send('update-not-available');
  });

  // Event: Download progress
  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update-download-progress', progress);
  });

  // Event: Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded');
    mainWindow.webContents.send('update-downloaded');
  });

  // Event: Error
  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err);
    logToFile('General update error', err);
    mainWindow.webContents.send('update-error', err.message || 'Unknown update error');
  });

  // IPC Handlers
  ipcMain.handle('check-for-updates', async () => {
    console.log('[AutoUpdater] IPC check-for-updates triggered');
    try {
      if (!app.isPackaged) {
          console.log('[AutoUpdater] Development mode: skipping native check');
          return { success: true, message: 'Updates check skipped in development mode' };
      }
      
      console.log('[AutoUpdater] Running native checkForUpdates()...');
      const result = await autoUpdater.checkForUpdates();
      console.log('[AutoUpdater] Native check complete. Version found:', result?.updateInfo?.version || 'None');
      
      return { success: true, updateInfo: result ? result.updateInfo : null };
    } catch (error) {
      console.error('[AutoUpdater] Native check failed:', error);
      logToFile('Native check failed', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('start-update-download', async () => {
    console.log('[AutoUpdater] IPC start-update-download triggered');
    try {
      if (!app.isPackaged) {
          console.log('[AutoUpdater] Development mode: mocking download success');
          // In dev mode, we just simulate the event that the renderer expects
          setTimeout(() => {
            mainWindow.webContents.send('update-download-progress', { percent: 50, transferred: 50, total: 100 });
          }, 500);
          setTimeout(() => {
            mainWindow.webContents.send('update-downloaded');
          }, 1500);
          return { success: true };
      }
      
      console.log('[AutoUpdater] Starting downloadUpdate()...');
      const result = await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      console.error('[AutoUpdater] Download failed:', error);
      logToFile('Download failed', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('install-update', () => {
    console.log('[AutoUpdater] Install requested');
    autoUpdater.quitAndInstall();
  });

  // --- Hybrid Logic (DB/Remote Version Check) ---
  
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });


  // Example of deep version check logic requested by user
  ipcMain.handle('check-version-status', async (event, remoteConfig) => {
    const currentVersion = app.getVersion();

    
    // remoteConfig would come from the database/API call in the renderer
    const { latest_version, min_supported_version } = remoteConfig;
    
    if (!latest_version) return { status: 'latest' };

    // Use semver for proper version comparison
    if (min_supported_version && semver.lt(currentVersion, min_supported_version)) {
      return { 
        status: 'force-update', 
        current: currentVersion, 
        latest: latest_version,
        min: min_supported_version
      };
    } else if (semver.lt(currentVersion, latest_version)) {
      return { 
        status: 'update-available', 
        current: currentVersion, 
        latest: latest_version 
      };
    }

    return { status: 'latest', current: currentVersion };
  });
}

module.exports = {
  initialize
};

