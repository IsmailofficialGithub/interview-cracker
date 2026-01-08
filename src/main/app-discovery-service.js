/**
 * App Discovery Service
 * Discovers installed Windows applications via Registry and Program Files
 */

const path = require('path');

let nativeAddon = null;
let cachedApps = null;
let lastScanTime = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Load native addon
function loadNativeAddon() {
  try {
    const addonPath = path.join(__dirname, '../../native/build/Release/window-manager.node');
    nativeAddon = require(addonPath);
    return true;
  } catch (error) {
    console.error('Failed to load native addon for app discovery:', error);
    return false;
  }
}

/**
 * Initialize app discovery service
 */
function initialize() {
  if (!loadNativeAddon()) {
    throw new Error('Failed to load native app discovery addon');
  }
  console.log('App Discovery Service initialized');
}

/**
 * Discover installed applications
 * @returns {Promise<Array>} Array of app objects
 */
async function discoverApps() {
  if (!nativeAddon) {
    throw new Error('Native addon not loaded');
  }
  
  try {
    // Scan registry
    const registryApps = nativeAddon.scanRegistry();
    const registryAppsArray = Array.from(registryApps);
    
    // Scan Program Files
    const programFilesApps = nativeAddon.scanProgramFiles();
    const programFilesAppsArray = Array.from(programFilesApps);
    
    // Scan System Apps (Notepad, Calculator, etc.)
    const systemApps = nativeAddon.scanSystemApps();
    const systemAppsArray = Array.from(systemApps);
    
    // Merge results
    const appsMap = new Map();
    
    // Add registry apps first (they have better metadata)
    registryAppsArray.forEach(app => {
      const appPath = app.path;
      if (appPath && !appsMap.has(appPath)) {
        appsMap.set(appPath, {
          id: app.id || `reg_${Date.now()}_${Math.random()}`,
          name: app.name || path.basename(appPath, '.exe'),
          path: appPath,
          icon: app.icon || appPath
        });
      }
    });
    
    // Add Program Files apps (skip if already in map)
    programFilesAppsArray.forEach(app => {
      const appPath = app.path;
      if (appPath && !appsMap.has(appPath)) {
        appsMap.set(appPath, {
          id: app.id || `pf_${Date.now()}_${Math.random()}`,
          name: app.name || path.basename(appPath, '.exe'),
          path: appPath,
          icon: app.icon || appPath
        });
      }
    });
    
    // Add System Apps (Notepad, Calculator, etc.) - prioritize these
    systemAppsArray.forEach(app => {
      const appPath = app.path;
      if (appPath && !appsMap.has(appPath)) {
        appsMap.set(appPath, {
          id: app.id || `sys_${Date.now()}_${Math.random()}`,
          name: app.name || path.basename(appPath, '.exe'),
          path: appPath,
          icon: app.icon || appPath
        });
      }
    });
    
    // Convert map to array
    const apps = Array.from(appsMap.values());
    
    // Sort by name
    apps.sort((a, b) => a.name.localeCompare(b.name));
    
    // Cache results
    cachedApps = apps;
    lastScanTime = Date.now();
    
    return apps;
  } catch (error) {
    console.error('Error discovering apps:', error);
    throw error;
  }
}

/**
 * Get cached apps or discover if cache is stale
 * @returns {Promise<Array>} Array of app objects
 */
async function getCachedApps() {
  const now = Date.now();
  
  // Return cache if fresh
  if (cachedApps && (now - lastScanTime) < CACHE_DURATION) {
    return cachedApps;
  }
  
  // Refresh cache
  return await discoverApps();
}

/**
 * Force refresh of app list
 * @returns {Promise<Array>} Array of app objects
 */
async function refreshApps() {
  cachedApps = null;
  lastScanTime = 0;
  return await discoverApps();
}

/**
 * Find app by ID
 * @param {string} appId - App identifier
 * @returns {Promise<Object|null>} App object or null
 */
async function findAppById(appId) {
  const apps = await getCachedApps();
  return apps.find(app => app.id === appId) || null;
}

/**
 * Find app by path
 * @param {string} appPath - Application executable path
 * @returns {Promise<Object|null>} App object or null
 */
async function findAppByPath(appPath) {
  const apps = await getCachedApps();
  return apps.find(app => app.path === appPath) || null;
}

module.exports = {
  initialize,
  discoverApps,
  getCachedApps,
  refreshApps,
  findAppById,
  findAppByPath
};

