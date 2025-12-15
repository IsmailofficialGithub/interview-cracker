/**
 * Settings Panel
 * Manages settings and account configuration
 */

class SettingsPanel {
  constructor() {
    this.panel = null;
    this.isOpen = false;
    this.config = null;
  }

  /**
   * Initialize settings panel
   */
  async initialize() {
    await this.loadConfig();
    this.setupUI();
  }

  /**
   * Load configuration
   */
  async loadConfig() {
    try {
      const result = await window.electronAPI.getConfig();
      if (result.success) {
        this.config = result.data || { accounts: [], settings: {} };
      } else {
        this.config = { accounts: [], settings: {} };
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      this.config = { accounts: [], settings: {} };
    }
  }

  /**
   * Setup UI
   */
  setupUI() {
    // Settings button click handler (will be set by renderer)
    // This class provides the panel HTML and logic
  }

  /**
   * Show settings panel
   */
  show() {
    if (this.isOpen) return;

    const panelHTML = `
      <div id="settings-panel" class="settings-panel-overlay">
        <div class="settings-panel-content">
          <div class="settings-header">
            <h2>Settings</h2>
            <button id="settings-close" class="settings-close-btn">
              <i data-feather="x" class="icon"></i>
            </button>
          </div>
          <div class="settings-body">
            ${this.renderSettingsContent()}
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', panelHTML);
    this.panel = document.getElementById('settings-panel');
    this.isOpen = true;

    // Close button
    document.getElementById('settings-close').addEventListener('click', () => {
      this.hide();
    });

    // Close on overlay click
    this.panel.addEventListener('click', (e) => {
      if (e.target === this.panel) {
        this.hide();
      }
    });

    // Setup form handlers
    this.setupFormHandlers();

    // Initialize icons
    if (typeof feather !== 'undefined') {
      feather.replace();
    }
  }

  /**
   * Hide settings panel
   */
  hide() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      this.isOpen = false;
    }
  }

  /**
   * Render settings content
   */
  renderSettingsContent() {
    return `
      <div class="settings-tabs">
        <button class="settings-tab active" data-tab="accounts">AI Accounts</button>
        <button class="settings-tab" data-tab="privacy">Privacy</button>
        <button class="settings-tab" data-tab="general">General</button>
      </div>
      
      <div class="settings-tab-content" id="accounts-tab">
        ${this.renderAccountsTab()}
      </div>
      
      <div class="settings-tab-content" id="privacy-tab" style="display: none;">
        ${this.renderPrivacyTab()}
      </div>
      
      <div class="settings-tab-content" id="general-tab" style="display: none;">
        ${this.renderGeneralTab()}
      </div>
    `;
  }

  /**
   * Render accounts tab
   */
  renderAccountsTab() {
    const accounts = this.config.accounts || [];

    let html = `
      <div class="accounts-list">
        ${accounts.map((acc, idx) => `
          <div class="account-item">
            <div class="account-info">
              <strong>${acc.name || 'Untitled Account'}</strong>
              <span class="account-type">${acc.type}</span>
            </div>
            <button class="account-edit-btn" data-index="${idx}">Edit</button>
            <button class="account-delete-btn" data-index="${idx}">Delete</button>
          </div>
        `).join('')}
        ${accounts.length === 0 ? '<p>No accounts configured. Add one below.</p>' : ''}
      </div>
      
      <button id="add-account-btn" class="add-account-btn">+ Add Account</button>
      
      <div id="account-form" class="account-form" style="display: none;">
        <h3>Add/Edit Account</h3>
        <form id="account-form-content">
          <input type="hidden" id="account-index" value="-1" />
          
          <div class="form-group">
            <label>Account Name</label>
            <input type="text" id="account-name" required />
          </div>
          
          <div class="form-group">
            <label>Provider Type</label>
            <select id="account-type" required>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (Local)</option>
              <option value="openai-compatible">OpenAI-Compatible</option>
            </select>
          </div>
          
          <div class="form-group" id="api-key-group">
            <label>API Key</label>
            <input type="password" id="account-api-key" placeholder="Enter API key" />
            <small>Leave empty for local providers like Ollama</small>
          </div>
          
          <div class="form-group">
            <label>Model</label>
            <input type="text" id="account-model" placeholder="e.g., gpt-4, llama2" required />
          </div>
          
          <div class="form-group" id="base-url-group">
            <label>Base URL</label>
            <input type="text" id="account-base-url" placeholder="Leave empty for defaults" />
          </div>
          
          <div class="form-actions">
            <button type="submit" class="save-btn">Save</button>
            <button type="button" class="cancel-btn" id="cancel-account-form">Cancel</button>
          </div>
        </form>
      </div>
    `;

    return html;
  }

  /**
   * Render privacy tab
   */
  renderPrivacyTab() {
    const settings = this.config.settings || {};

    return `
      <div class="settings-section">
        <h3>Auto-Lock</h3>
        <div class="setting-item">
          <label>
            <input type="checkbox" id="auto-lock" ${settings.autoLock !== false ? 'checked' : ''} />
            Enable auto-lock on idle
          </label>
        </div>
        <div class="setting-item">
          <label>
            Auto-lock after (minutes):
            <input type="number" id="auto-lock-minutes" value="${settings.autoLockMinutes || 15}" min="1" max="60" />
          </label>
        </div>
      </div>
      
      <div class="settings-section">
        <h3>Privacy</h3>
        <div class="setting-item">
          <label>
            <input type="checkbox" id="auto-blur" ${settings.autoBlur ? 'checked' : ''} />
            Blur chat when window loses focus
          </label>
        </div>
        <div class="setting-item">
          <label>
            Message retention (days, 0 = never delete):
            <input type="number" id="message-retention" value="${settings.messageRetentionDays || 0}" min="0" />
          </label>
        </div>
      </div>

      <div class="settings-section">
        <h3>Shortcuts</h3>
        <div class="setting-item">
          <label>
            Hide/Show App Shortcut:
            <input type="text" id="hide-shortcut" value="${settings.hideShortcut || 'Ctrl+Alt+H'}" placeholder="e.g. Ctrl+Alt+H" />
          </label>
        </div>
        <div class="setting-item">
          <label>
            Ghost Type Shortcut (Simulate Human Typing):
            <input type="text" id="ghost-shortcut" value="${settings.ghostShortcut || 'Ctrl+Alt+V'}" placeholder="e.g. Ctrl+Alt+V" />
          </label>
        </div>
        <div class="setting-item" style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px;">
           <label style="display: block; margin-bottom: 5px;">Typing Speed (WPM):</label>
           <div style="display: flex; align-items: center; gap: 10px;">
             <input type="number" id="ghost-wpm" value="${settings.ghostWpm || 60}" min="10" max="200" style="width: 80px;" />
             <small style="color: #888;">(Higher is faster)</small>
           </div>
        </div>
      </div>
      
      <div class="settings-actions">
        <button id="save-privacy-settings" class="save-btn">Save Settings</button>
      </div>
    `;
  }

  /**
   * Render general tab
   */
  renderGeneralTab() {
    return `
      <div class="settings-section">
        <h3>About</h3>
        <p>Private AI Chat v1.0.0</p>
        <p>Secure, encrypted AI chat application</p>
      </div>
    `;
  }

  /**
   * Setup form handlers
   */
  setupFormHandlers() {
    // Tab switching
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        // Update active tab
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Show corresponding content
        document.querySelectorAll('.settings-tab-content').forEach(content => {
          content.style.display = 'none';
        });
        document.getElementById(`${tabName}-tab`).style.display = 'block';
      });
    });

    // Provider type change
    const accountType = document.getElementById('account-type');
    if (accountType) {
      accountType.addEventListener('change', () => {
        const type = accountType.value;
        const apiKeyGroup = document.getElementById('api-key-group');
        const baseUrlGroup = document.getElementById('base-url-group');

        if (type === 'ollama') {
          apiKeyGroup.style.display = 'none';
          baseUrlGroup.style.display = 'block';
          document.getElementById('account-base-url').placeholder = 'http://localhost:11434';
        } else if (type === 'openai') {
          apiKeyGroup.style.display = 'block';
          baseUrlGroup.style.display = 'none';
        } else {
          apiKeyGroup.style.display = 'block';
          baseUrlGroup.style.display = 'block';
        }
      });
    }

    // Add account button
    const addAccountBtn = document.getElementById('add-account-btn');
    if (addAccountBtn) {
      addAccountBtn.addEventListener('click', () => {
        document.getElementById('account-form').style.display = 'block';
        document.getElementById('account-index').value = '-1';
      });
    }

    // Cancel account form
    const cancelBtn = document.getElementById('cancel-account-form');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        document.getElementById('account-form').style.display = 'none';
      });
    }

    // Account form submit (will be handled by save handler)
    const accountForm = document.getElementById('account-form-content');
    if (accountForm) {
      accountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveAccount();
      });
    }

    // Save privacy settings
    const savePrivacyBtn = document.getElementById('save-privacy-settings');
    if (savePrivacyBtn) {
      savePrivacyBtn.addEventListener('click', async () => {
        await this.savePrivacySettings();
      });
    }
  }

  /**
   * Save account
   */
  async saveAccount() {
    const index = parseInt(document.getElementById('account-index').value);
    const account = {
      name: document.getElementById('account-name').value,
      type: document.getElementById('account-type').value,
      model: document.getElementById('account-model').value,
      apiKey: document.getElementById('account-api-key').value || '',
      baseURL: document.getElementById('account-base-url').value || undefined
    };

    if (!this.config.accounts) {
      this.config.accounts = [];
    }

    if (index >= 0) {
      this.config.accounts[index] = account;
    } else {
      this.config.accounts.push(account);
    }

    await this.saveConfig();
    this.hide();
    this.show(); // Refresh
  }

  /**
   * Save privacy settings
   */
  async savePrivacySettings() {
    if (!this.config.settings) {
      this.config.settings = {};
    }

    this.config.settings.autoLock = document.getElementById('auto-lock').checked;
    this.config.settings.autoLockMinutes = parseInt(document.getElementById('auto-lock-minutes').value);
    this.config.settings.autoBlur = document.getElementById('auto-blur').checked;
    this.config.settings.messageRetentionDays = parseInt(document.getElementById('message-retention').value);

    // Save shortcuts
    const shortcutInput = document.getElementById('hide-shortcut');
    if (shortcutInput) {
      const newShortcut = shortcutInput.value.trim();
      if (newShortcut && this.config.settings.hideShortcut !== newShortcut) {
        this.config.settings.hideShortcut = newShortcut;
        // Update main process
        await window.electronAPI.updateShortcut(newShortcut);
      }
    }

    const ghostShortcutInput = document.getElementById('ghost-shortcut');
    if (ghostShortcutInput) {
      const newGhostShortcut = ghostShortcutInput.value.trim();
      if (newGhostShortcut && this.config.settings.ghostShortcut !== newGhostShortcut) {
        this.config.settings.ghostShortcut = newGhostShortcut;
        await window.electronAPI.updateGhostShortcut(newGhostShortcut);
      }
    }

    const ghostWpmInput = document.getElementById('ghost-wpm');
    if (ghostWpmInput) {
      const newGhostWpm = parseInt(ghostWpmInput.value);
      if (newGhostWpm && this.config.settings.ghostWpm !== newGhostWpm) {
        this.config.settings.ghostWpm = newGhostWpm;
        await window.electronAPI.updateGhostWpm(newGhostWpm);
      }
    }

    await this.saveConfig();
    alert('Settings saved');
  }



  /**
   * Save configuration
   */
  async saveConfig() {
    try {
      const result = await window.electronAPI.saveConfig(this.config);
      if (!result.success) {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Failed to save settings: ' + error.message);
    }
  }
}

module.exports = SettingsPanel;

