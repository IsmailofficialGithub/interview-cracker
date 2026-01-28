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
        
        // DEBUG: Log loaded accounts and their API keys
        if (this.config.accounts && this.config.accounts.length > 0) {
          console.log('[DEBUG] Loaded config with accounts:');
          this.config.accounts.forEach((acc, idx) => {
            console.log(`  Account ${idx}:`, {
              name: acc.name,
              type: acc.type,
              model: acc.model,
              hasApiKey: !!acc.apiKey,
              apiKeyLength: acc.apiKey ? acc.apiKey.length : 0,
              apiKeyPreview: acc.apiKey ? acc.apiKey.substring(0, 10) + '...' + acc.apiKey.slice(-4) : 'none'
            });
          });
        }
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
            <label>API Key <span id="api-key-required" style="color: #ff6b6b; display: none;">*</span></label>
            <input type="password" id="account-api-key" placeholder="Enter API key" />
            <small>Leave empty for local providers like Ollama</small>
          </div>
          
          <div class="form-group">
            <label>Model</label>
            <select id="account-model" required style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 10px; border-radius: 6px; margin-top: 8px;">
              <option value="">Select a model...</option>
            </select>
            <input type="text" id="account-model-custom" placeholder="Or enter custom model name" style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 10px; border-radius: 6px; margin-top: 8px; display: none;" />
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
        <div class="setting-item">
           <label style="display: block; margin-bottom: 5px;">Mistake Chance (%):</label>
           <div style="display: flex; align-items: center; gap: 10px;">
             <input type="number" id="ghost-mistake-chance" value="${settings.ghostMistakeChance !== undefined ? settings.ghostMistakeChance : 5}" min="0" max="100" style="width: 80px;" />
             <small style="color: #888;">(0 = Perfect typing)</small>
           </div>
        </div>
        <div class="setting-item">
           <label style="display: block; margin-bottom: 5px;">Max Consecutive Mistakes:</label>
           <div style="display: flex; align-items: center; gap: 10px;">
             <input type="number" id="ghost-max-mistakes" value="${settings.ghostMaxMistakes || 1}" min="1" max="5" style="width: 80px;" />
             <small style="color: #888;">(Max wrong chars at once)</small>
           </div>
        </div>

      </div>

      <div class="settings-section">
        <h3>Voice Input (Speech-to-Text)</h3>
        <div class="setting-item" style="margin-bottom: 16px;">
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="voice-enabled" ${settings.voiceEnabled !== false ? 'checked' : ''} />
            Enable voice input
          </label>
          <small style="display: block; margin-top: 4px; color: #999; font-size: 12px;">
            Click the Listen button to use voice input
          </small>
        </div>
        <div class="setting-item" style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px;">
            Speech Recognition API:
          </label>
          <select id="voice-api" style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 8px; border-radius: 6px; font-size: 14px;">
            <option value="groq-whisper" ${!settings.voiceAPI || settings.voiceAPI === 'groq-whisper' ? 'selected' : ''}>Groq Whisper (Recommended - Fast & Reliable)</option>
            <option value="openai-whisper" ${settings.voiceAPI === 'openai-whisper' ? 'selected' : ''}>OpenAI Whisper (whisper-1)</option>
            <option value="web-speech" ${settings.voiceAPI === 'web-speech' ? 'selected' : ''}>Web Speech API (Browser - May be blocked)</option>
          </select>
          <small style="display: block; margin-top: 4px; color: #999; font-size: 12px;">
            Web Speech: Free but requires internet. OpenAI/Groq: Requires API key but more accurate.
          </small>
        </div>
        <div class="setting-item" style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px;">
            Whisper Model (for Groq/OpenAI):
          </label>
          <select id="whisper-model" style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 8px; border-radius: 6px; font-size: 14px;">
            <option value="whisper-large-v3-turbo" ${settings.whisperModel === 'whisper-large-v3-turbo' ? 'selected' : ''}>Groq: whisper-large-v3-turbo (Recommended - Fast)</option>
            <option value="whisper-large-v3" ${settings.whisperModel === 'whisper-large-v3' ? 'selected' : ''}>Groq: whisper-large-v3</option>
            <option value="whisper-1" ${settings.whisperModel === 'whisper-1' ? 'selected' : ''}>OpenAI: whisper-1</option>
          </select>
          <small style="display: block; margin-top: 4px; color: #999; font-size: 12px;">
            Select the model based on your chosen API above
          </small>
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
      const updateFormForProviderType = () => {
        const type = accountType.value;
        const apiKeyGroup = document.getElementById('api-key-group');
        const baseUrlGroup = document.getElementById('base-url-group');
        const apiKeyRequired = document.getElementById('api-key-required');
        const apiKeyInput = document.getElementById('account-api-key');

        if (type === 'ollama') {
          apiKeyGroup.style.display = 'none';
          baseUrlGroup.style.display = 'block';
          const baseUrlInput = document.getElementById('account-base-url');
          if (baseUrlInput) baseUrlInput.placeholder = 'http://localhost:11434';
          if (apiKeyRequired) apiKeyRequired.style.display = 'none';
          if (apiKeyInput) apiKeyInput.removeAttribute('required');
        } else if (type === 'openai') {
          apiKeyGroup.style.display = 'block';
          baseUrlGroup.style.display = 'none';
          if (apiKeyRequired) apiKeyRequired.style.display = 'inline';
          if (apiKeyInput) {
            apiKeyInput.setAttribute('required', 'required');
            // Ensure API key input is enabled and accessible
            apiKeyInput.disabled = false;
            apiKeyInput.readOnly = false;
            apiKeyInput.style.pointerEvents = 'auto';
            apiKeyInput.removeAttribute('disabled');
            apiKeyInput.removeAttribute('readonly');
          }
        } else {
          apiKeyGroup.style.display = 'block';
          baseUrlGroup.style.display = 'block';
          if (apiKeyRequired) apiKeyRequired.style.display = 'none';
          if (apiKeyInput) {
            apiKeyInput.removeAttribute('required');
            // Ensure API key input is enabled
            apiKeyInput.disabled = false;
            apiKeyInput.readOnly = false;
            apiKeyInput.style.pointerEvents = 'auto';
            apiKeyInput.removeAttribute('disabled');
            apiKeyInput.removeAttribute('readonly');
        }
        }
        
        // Update model dropdown when provider type changes
        this.updateModelDropdown(type);
      };

      accountType.addEventListener('change', updateFormForProviderType);
      // Initialize on load
      setTimeout(() => {
        updateFormForProviderType();
      }, 100);
    }
    
    // Edit/Delete button handlers
    document.querySelectorAll('.account-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index);
        const account = this.config.accounts[index];
        if (!account) return;

        const accountForm = document.getElementById('account-form');
        const nameInput = document.getElementById('account-name');
        const typeInput = document.getElementById('account-type');
        const apiKeyInput = document.getElementById('account-api-key');
        const baseURLInput = document.getElementById('account-base-url');
        const indexInput = document.getElementById('account-index');
        const modelSelect = document.getElementById('account-model');
        const modelCustomInput = document.getElementById('account-model-custom');

        if (accountForm) {
          accountForm.style.display = 'block';
        }

        // Populate form with existing account data
        if (indexInput) indexInput.value = index;
        if (nameInput) nameInput.value = account.name || '';
        if (typeInput) typeInput.value = account.type || 'openai';
        if (apiKeyInput) {
          apiKeyInput.value = ''; // Don't show existing key for security
          apiKeyInput.disabled = false;
          apiKeyInput.readOnly = false;
          apiKeyInput.style.pointerEvents = 'auto';
        }
        if (baseURLInput) baseURLInput.value = account.baseURL || '';

        // Update model dropdown
        const providerType = account.type || 'openai';
        this.updateModelDropdown(providerType);

        // Set model value
        setTimeout(() => {
          const savedModel = account.model || '';
          if (modelSelect) {
            const optionExists = Array.from(modelSelect.options).some(opt => opt.value === savedModel);
            if (optionExists) {
              modelSelect.value = savedModel;
              if (modelCustomInput) {
                modelCustomInput.style.display = 'none';
                modelCustomInput.value = '';
              }
            } else {
              modelSelect.value = '__custom__';
              if (modelCustomInput) {
                modelCustomInput.value = savedModel;
                modelCustomInput.style.display = 'block';
              }
            }
          }
          // Trigger type change to update visibility
          if (typeInput) {
            typeInput.dispatchEvent(new Event('change'));
          }
        }, 100);
      });
    });

    document.querySelectorAll('.account-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt(btn.dataset.index);
        if (confirm('Are you sure you want to delete this account?')) {
          if (this.config.accounts && index >= 0 && index < this.config.accounts.length) {
            this.config.accounts.splice(index, 1);
            await this.saveConfig();
            await this.loadConfig();
            this.hide();
            this.show();
          }
        }
      });
    });

    // Initialize model dropdown when form is shown
    const addAccountBtn = document.getElementById('add-account-btn');
    if (addAccountBtn) {
      addAccountBtn.addEventListener('click', () => {
        const accountForm = document.getElementById('account-form');
        const apiKeyInput = document.getElementById('account-api-key');
        const nameInput = document.getElementById('account-name');
        const baseUrlInput = document.getElementById('account-base-url');
        
        if (accountForm) {
          accountForm.style.display = 'block';
        }
        
        // Clear and enable all inputs
        if (document.getElementById('account-index')) {
        document.getElementById('account-index').value = '-1';
        }
        if (nameInput) {
          nameInput.value = '';
          nameInput.disabled = false;
          nameInput.readOnly = false;
          nameInput.style.pointerEvents = 'auto';
        }
        if (apiKeyInput) {
          apiKeyInput.value = '';
          apiKeyInput.disabled = false;
          apiKeyInput.readOnly = false;
          apiKeyInput.style.pointerEvents = 'auto';
          apiKeyInput.removeAttribute('disabled');
          apiKeyInput.removeAttribute('readonly');
        }
        if (baseUrlInput) {
          baseUrlInput.value = '';
          baseUrlInput.disabled = false;
          baseUrlInput.readOnly = false;
          baseUrlInput.style.pointerEvents = 'auto';
        }
        
        // Initialize model dropdown
        const type = document.getElementById('account-type')?.value || 'openai';
        setTimeout(() => {
          this.updateModelDropdown(type);
          // Focus on API key input after a short delay
          if (apiKeyInput) {
            setTimeout(() => apiKeyInput.focus(), 100);
          }
        }, 50);
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
    try {
      const nameInput = document.getElementById('account-name');
      const typeInput = document.getElementById('account-type');
      const modelSelect = document.getElementById('account-model');
      const modelCustomInput = document.getElementById('account-model-custom');
      const apiKeyInput = document.getElementById('account-api-key');
      const baseURLInput = document.getElementById('account-base-url');
      const indexInput = document.getElementById('account-index');

      // Validate required fields
      if (!nameInput || !nameInput.value.trim()) {
        alert('Please enter an account name');
        return;
      }

      // Get model value from dropdown or custom input
      let modelValue = '';
      if (modelSelect) {
        if (modelSelect.value === '__custom__' && modelCustomInput) {
          modelValue = modelCustomInput.value.trim();
        } else {
          modelValue = modelSelect.value.trim();
        }
      }

      if (!modelValue) {
        alert('Please select or enter a model name');
        return;
      }

      const index = parseInt(indexInput.value);
      
      // Get API key from input
      let apiKeyValue = '';
      if (apiKeyInput) {
        apiKeyValue = apiKeyInput.value.trim();
        console.log('API Key input value length:', apiKeyValue.length);
      }

    const account = {
        name: nameInput.value.trim(),
        type: typeInput.value,
        model: modelValue,
        apiKey: apiKeyValue,
        baseURL: baseURLInput && baseURLInput.value.trim() ? baseURLInput.value.trim() : undefined
      };

      // If editing and API key is empty, preserve existing key
      if (index >= 0 && index < this.config.accounts.length) {
        const existingAccount = this.config.accounts[index];
        if (existingAccount) {
          // If no new API key provided, preserve the existing one
          if (!account.apiKey && existingAccount.apiKey) {
            account.apiKey = existingAccount.apiKey;
            console.log('Preserving existing API key for account:', account.name);
          } else if (account.apiKey) {
            console.log('Using new API key for account:', account.name);
          }
        }
      }

      // Validate API key for OpenAI (only for new accounts or if explicitly provided)
      if (account.type === 'openai' && !account.apiKey) {
        alert('API Key is required for OpenAI provider');
        return;
      }

      console.log('Saving account:', { 
        name: account.name,
        type: account.type,
        model: account.model,
        apiKey: account.apiKey ? '***' + account.apiKey.slice(-4) : 'empty',
        apiKeyLength: account.apiKey ? account.apiKey.length : 0,
        isEdit: index >= 0,
        baseURL: account.baseURL || 'none'
      });
      
      // Verify the account object has the API key before saving
      if (account.type === 'openai' && account.apiKey) {
        console.log('✓ OpenAI account has API key, length:', account.apiKey.length);
      } else if (account.type === 'openai' && !account.apiKey) {
        console.error('✗ OpenAI account missing API key!');
      }

    if (!this.config.accounts) {
      this.config.accounts = [];
    }

      if (index >= 0 && index < this.config.accounts.length) {
      this.config.accounts[index] = account;
    } else {
      this.config.accounts.push(account);
    }

      const saveResult = await this.saveConfig();
      if (saveResult) {
        // DEBUG: Verify the account was saved correctly
        await this.loadConfig();
        const savedAccount = this.config.accounts.find(acc => 
          acc.name === account.name && acc.type === account.type
        );
        if (savedAccount) {
          console.log('[DEBUG] Account saved verification:', {
            name: savedAccount.name,
            type: savedAccount.type,
            hasApiKey: !!savedAccount.apiKey,
            apiKeyLength: savedAccount.apiKey ? savedAccount.apiKey.length : 0,
            apiKeyPreview: savedAccount.apiKey ? savedAccount.apiKey.substring(0, 10) + '...' + savedAccount.apiKey.slice(-4) : 'none'
          });
          
          if (account.type === 'openai') {
            if (savedAccount.apiKey && savedAccount.apiKey.length > 0) {
              console.log('✓ API key verified in saved account');
            } else {
              console.error('✗ API key NOT found in saved account!');
              alert('Warning: API key may not have been saved correctly. Please verify in Settings.');
            }
          }
        } else {
          console.error('✗ Saved account not found after reload');
        }
        
        // Hide form and refresh
        const accountForm = document.getElementById('account-form');
        if (accountForm) {
          accountForm.style.display = 'none';
        }
        // Clear form
        if (nameInput) nameInput.value = '';
        if (modelSelect) {
          modelSelect.value = '';
          this.updateModelDropdown(typeInput.value);
        }
        if (modelCustomInput) {
          modelCustomInput.value = '';
          modelCustomInput.style.display = 'none';
        }
        if (apiKeyInput) apiKeyInput.value = '';
        if (baseURLInput) baseURLInput.value = '';
        if (indexInput) indexInput.value = '-1';
        
        // Refresh UI
    this.hide();
        this.show();
        alert('Account saved successfully!');
      }
    } catch (error) {
      console.error('Error saving account:', error);
      alert('Failed to save account: ' + error.message);
    }
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

    if (ghostWpmInput) {
      const newGhostWpm = parseInt(ghostWpmInput.value);
      if (newGhostWpm && this.config.settings.ghostWpm !== newGhostWpm) {
        this.config.settings.ghostWpm = newGhostWpm;
        await window.electronAPI.updateGhostWpm(newGhostWpm);
      }
    }

    // Save voice settings (if they exist in the UI)
    const voiceEnabledCheckbox = document.getElementById('voice-enabled');
    if (voiceEnabledCheckbox) {
      this.config.settings.voiceEnabled = voiceEnabledCheckbox.checked;
    }

    const voiceAPI = document.getElementById('voice-api');
    if (voiceAPI) {
      this.config.settings.voiceAPI = voiceAPI.value;
      console.log('[SettingsPanel] Saving voiceAPI setting:', voiceAPI.value);
    }

    const whisperModel = document.getElementById('whisper-model');
    if (whisperModel) {
      this.config.settings.whisperModel = whisperModel.value;
    }

    await this.saveConfig();
    alert('Settings saved');
  }



  /**
   * Save configuration
   */
  async saveConfig() {
    try {
      console.log('Saving config with accounts:', this.config.accounts?.length || 0);
      // Log account details for debugging
      if (this.config.accounts && this.config.accounts.length > 0) {
        this.config.accounts.forEach((acc, idx) => {
          console.log(`Account ${idx}:`, {
            name: acc.name,
            type: acc.type,
            hasApiKey: !!acc.apiKey,
            apiKeyLength: acc.apiKey ? acc.apiKey.length : 0
          });
        });
      }
      const result = await window.electronAPI.saveConfig(this.config);
      if (!result.success) {
        throw new Error(result.error || 'Unknown error saving configuration');
      }
      console.log('Config saved successfully');
      return true;
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Failed to save settings: ' + error.message);
      return false;
    }
  }

  /**
   * Update model dropdown based on provider type
   */
  updateModelDropdown(providerType) {
    const modelSelect = document.getElementById('account-model');
    const modelCustomInput = document.getElementById('account-model-custom');

    if (!modelSelect) return;

    // Clear existing options
    modelSelect.innerHTML = '<option value="">Select a model...</option>';

    let models = [];

    switch (providerType) {
      case 'openai':
        models = [
          { value: 'gpt-4-turbo-preview', label: 'GPT-4 Turbo Preview' },
          { value: 'gpt-4', label: 'GPT-4' },
          { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
          { value: 'gpt-3.5-turbo-16k', label: 'GPT-3.5 Turbo 16k' },
          { value: 'gpt-4o', label: 'GPT-4o' },
          { value: 'gpt-4o-mini', label: 'GPT-4o Mini' }
        ];
        break;
      case 'ollama':
        models = [
          { value: 'llama2', label: 'Llama 2' },
          { value: 'llama2:13b', label: 'Llama 2 13B' },
          { value: 'llama2:70b', label: 'Llama 2 70B' },
          { value: 'mistral', label: 'Mistral' },
          { value: 'codellama', label: 'Code Llama' },
          { value: 'neural-chat', label: 'Neural Chat' },
          { value: 'starling-lm', label: 'Starling LM' },
          { value: 'phi', label: 'Phi' }
        ];
        break;
      case 'openai-compatible':
        models = [
          { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Default)' },
          { value: 'gpt-4', label: 'GPT-4' }
        ];
        break;
      default:
        models = [];
    }

    // Add models to dropdown
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.label;
      modelSelect.appendChild(option);
    });

    // Add custom option
    const customOption = document.createElement('option');
    customOption.value = '__custom__';
    customOption.textContent = 'Custom (enter below)';
    modelSelect.appendChild(customOption);

    // Reset custom input
    if (modelCustomInput) {
      modelCustomInput.value = '';
      modelCustomInput.style.display = 'none';
      modelCustomInput.required = false;
      modelSelect.required = true;
    }

    // Setup event listener for model dropdown change (to show/hide custom input)
    this.setupModelDropdownListener();
  }

  /**
   * Setup model dropdown listener to show/hide custom input
   */
  setupModelDropdownListener() {
    const modelSelect = document.getElementById('account-model');
    const modelCustomInput = document.getElementById('account-model-custom');

    if (!modelSelect || !modelCustomInput) return;

    // Use flag to prevent duplicate listeners instead of cloning
    if (modelSelect.dataset.listenerAttached === 'true') {
      return;
    }
    modelSelect.dataset.listenerAttached = 'true';

    // Add listener directly without cloning
    modelSelect.addEventListener('change', () => {
      const customInput = document.getElementById('account-model-custom');
      if (modelSelect.value === '__custom__') {
        if (customInput) {
          customInput.style.display = 'block';
          customInput.required = true;
          customInput.disabled = false;
          customInput.readOnly = false;
          customInput.style.pointerEvents = 'auto';
          customInput.focus();
        }
        modelSelect.required = false;
      } else {
        if (customInput) {
          customInput.style.display = 'none';
          customInput.value = '';
          customInput.required = false;
        }
        modelSelect.required = true;
      }
    });
  }
}

module.exports = SettingsPanel;

