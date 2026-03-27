/**
 * Update Manager
 * Handles application update UI and logic
 */

class UpdateManager {
  constructor() {
    this.remoteVersionUrl = 'https://raw.githubusercontent.com/IsmailofficialGithub/interview-cracker/main/version.json';
    this.currentStatus = 'checked';
    this.modal = null;
    this.isInitialized = false;
    this.isSimulated = false;

    // Bind listeners
    this.setupListeners();
  }

  /**
   * Setup IPC listeners for update events
   */
  setupListeners() {
    if (!window.electronAPI) return;

    window.electronAPI.onUpdateAvailable((info) => {
      console.log('[UpdateManager] Update available info:', info);
      this.showUpdateModal(info.version, false);
    });

    window.electronAPI.onUpdateDownloadProgress((progress) => {
      this.updateProgress(progress);
    });

    window.electronAPI.onUpdateDownloaded(() => {
      this.showInstallUI();
    });

    window.electronAPI.onUpdateError((message) => {
      console.error('[UpdateManager] Update error:', message);
      this.showError(message);
    });
  }

  /**
   * Main check function called on app start
   */
  async checkForUpdates() {
    console.log('[UpdateManager] Checking for remote version info...');

    try {
      // 1. Fetch remote config (simulating DB query)
      const response = await fetch(`${this.remoteVersionUrl}?t=${Date.now()}`);
      if (!response.ok) throw new Error('Could not fetch version info');

      const remoteConfig = await response.json();
      console.log('[UpdateManager] Remote config:', remoteConfig);

      // 2. Compare versions via Main Process
      const status = await window.electronAPI.checkVersionStatus(remoteConfig);
      console.log('[UpdateManager] Version status:', status);

      if (status.status === 'force-update') {
        this.showUpdateModal(status.latest, true, status.min);
      } else if (status.status === 'update-available') {
        this.showUpdateModal(status.latest, false);
      } else {
        console.log('[UpdateManager] App is up to date');
      }
    } catch (error) {
      console.error('[UpdateManager] Version check failed:', error);
      // Fail silently for optional checks, but log for debugging
    }
  }

  /**
   * Build and show the update modal
   */
  showUpdateModal(version, isForce = false, minVersion = null) {
    if (this.modal) return;

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'update-modal-overlay';
    modalOverlay.style = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.85); display: flex; align-items: center;
      justify-content: center; z-index: 9999; backdrop-filter: blur(4px);
      animation: fadeIn 0.3s ease-out;
    `;

    const modalContent = document.createElement('div');
    modalContent.style = `
      background: #1e1e1e; border: 1px solid #333; border-radius: 12px;
      padding: 30px; width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.4);
      text-align: center; color: #e0e0e0;
    `;

    modalContent.innerHTML = `
      <div style="margin-bottom: 20px;">
        <div style="width: 60px; height: 60px; background: rgba(0, 122, 255, 0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px;">
           <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#007aff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </div>
        <h2 style="margin: 0; font-size: 20px; font-weight: 600;">Update Available</h2>
        <p style="color: #888; margin-top: 8px; font-size: 14px;">Version ${version} is ready to download.</p>
        ${isForce ? `<div style="background: rgba(255,59,48,0.1); color: #ff3b30; padding: 10px; border-radius: 6px; font-size: 12px; margin-top: 15px; border: 1px solid rgba(255,59,48,0.2);">
          <strong>Action Required:</strong> This is a critical security update. Your current version is no longer supported.
        </div>` : ''}
      </div>
      
      <div id="update-action-container" style="display: flex; flex-direction: column; gap: 10px; margin-top: 25px;">
        <button id="update-download-btn" style="background: #007aff; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: background 0.2s;">
          Download and Update
        </button>
        ${!isForce ? `
          <button id="update-skip-btn" style="background: transparent; color: #888; border: none; padding: 8px; font-size: 13px; cursor: pointer;">
            Remind me later
          </button>
        ` : ''}
      </div>
      
      <div id="update-progress-container" style="display: none; margin-top: 25px; text-align: left;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #888;">
          <span id="update-progress-status">Downloading...</span>
          <span id="update-progress-percent">0%</span>
        </div>
        <div style="width: 100%; height: 6px; background: #333; border-radius: 3px; overflow: hidden;">
          <div id="update-progress-bar" style="width: 0%; height: 100%; background: #007aff; transition: width 0.3s;"></div>
        </div>
        <div id="update-progress-mb" style="margin-top: 8px; font-size: 11px; color: #666; text-align: right;">0 MB / 0 MB</div>
      </div>
    `;

    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);
    this.modal = modalOverlay;

    // Button event listeners
    const downloadBtn = modalContent.querySelector('#update-download-btn');
    const skipBtn = modalContent.querySelector('#update-skip-btn');

    downloadBtn.addEventListener('click', async () => {
      downloadBtn.disabled = true;
      downloadBtn.style.opacity = '0.5';
      downloadBtn.textContent = 'Preparing...';

      // Show progress UI
      modalContent.querySelector('#update-action-container').style.display = 'none';
      modalContent.querySelector('#update-progress-container').style.display = 'block';

      try {
        // MUST check natively first so electron-updater knows what to download
        await window.electronAPI.checkForUpdates();
        await window.electronAPI.startUpdateDownload();
      } catch (err) {
        this.showError(err.message);
      }
    });

    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        document.body.removeChild(modalOverlay);
        this.modal = null;
      });
    }
  }

  /**
   * Update progress UI during download
   */
  updateProgress(progress) {
    if (!this.modal) return;

    const percent = Math.floor(progress.percent || 0);
    const downloadedMB = (progress.transferred / 1024 / 1024).toFixed(1);
    const totalMB = (progress.total / 1024 / 1024).toFixed(1);

    const progressBar = this.modal.querySelector('#update-progress-bar');
    const progressPercent = this.modal.querySelector('#update-progress-percent');
    const progressMB = this.modal.querySelector('#update-progress-mb');

    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressMB) progressMB.textContent = `${downloadedMB} MB / ${totalMB} MB`;
  }

  /**
   * Show installation UI when download is complete
   */
  showInstallUI() {
    if (!this.modal) return;

    const container = this.modal.querySelector('#update-progress-container');
    container.innerHTML = `
      <div style="background: rgba(52,199,89,0.1); color: #34c759; padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 20px; border: 1px solid rgba(52,199,89,0.2);">
        <svg style="margin-bottom: 8px;" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        <div style="font-weight: 600;">Download Complete!</div>
      </div>
      <button id="install-now-btn" style="width: 100%; background: #34c759; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer;">
        Restart and Install
      </button>
    `;

    const installBtn = this.modal.querySelector('#install-now-btn');
    installBtn.addEventListener('click', () => {
      if (this.isSimulated) {
        alert('Simulation Complete: The app would now restart and install the update.');
        location.reload();
      } else {
        window.electronAPI.installUpdate();
      }
    });
  }

  /**
   * Show error UI
   */
  showError(message) {
    if (!this.modal) return;
    const container = this.modal.querySelector('#update-progress-container') || this.modal.querySelector('#update-action-container');
    container.innerHTML = `
      <div style="background: rgba(255,59,48,0.1); color: #ff3b30; padding: 15px; border-radius: 8px; text-align: center; border: 1px solid rgba(255,59,48,0.2);">
        <div style="font-weight: 600; margin-bottom: 5px;">Update Failed</div>
        <div style="font-size: 12px; opacity: 0.8;">${message}</div>
      </div>
      <button onclick="location.reload()" style="width: 100%; background: #333; color: white; border: none; padding: 10px; border-radius: 8px; margin-top: 15px; cursor: pointer;">
        Try Again
      </button>
    `;
  }
  /**
   * Simulation for testing UI
   */
  async simulateUpdate(isForce = false) {
    this.isSimulated = true;
    console.log('[UpdateManager] Simulating update UI...');
    this.showUpdateModal('2.0.0-mock', isForce, '1.5.0');

    // Override download button behavior for simulation
    const downloadBtn = this.modal.querySelector('#update-download-btn');
    const newBtn = downloadBtn.cloneNode(true);
    downloadBtn.parentNode.replaceChild(newBtn, downloadBtn);

    newBtn.addEventListener('click', () => {
      this.modal.querySelector('#update-action-container').style.display = 'none';
      this.modal.querySelector('#update-progress-container').style.display = 'block';
      this.simulateProgress();
    });
  }

  simulateProgress() {
    let percent = 0;
    const interval = setInterval(() => {
      percent += Math.floor(Math.random() * 15) + 5;
      if (percent >= 100) {
        percent = 100;
        clearInterval(interval);
        setTimeout(() => this.showInstallUI(), 500);
      }
      this.updateProgress({
        percent: percent,
        transferred: percent * 1024 * 1024,
        total: 100 * 1024 * 1024
      });
    }, 400);
  }
}

// Global instance
window.updateManager = new UpdateManager();

// Debug shortcuts
window.simulateUpdate = (isForce) => window.updateManager.simulateUpdate(isForce);
