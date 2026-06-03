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
    this.setupRealTimeListeners();
    this.refreshMicrophoneChoices();

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
    const tabs = ['General', 'AI Accounts', 'Privacy', 'Voice Assistant'];
    const activeTab = this.activeTab || 'General';

    return `
      <div class="settings-tabs">
        ${tabs.map(tab => `
          <button class="settings-tab ${activeTab === tab ? 'active' : ''}" data-tab="${tab}">
            ${tab}
          </button>
        `).join('')}
      </div>
      <div id="settings-tab-content">
        ${this.renderActiveTabContent()}
      </div>
    `;
  }

  renderActiveTabContent() {
    const activeTab = this.activeTab || 'General';
    switch (activeTab) {
      case 'General': return this.renderGeneralTab();
      case 'AI Accounts': return this.renderAccountsTab();
      case 'Privacy': return this.renderPrivacyTab();
      case 'Voice Assistant': return this.renderVoiceTab();
      default: return this.renderGeneralTab();
    }
  }

  renderAccountsTab() {
    const accounts = this.config.accounts || [];
    return `
      <div class="accounts-list">
        ${accounts.map((acc, idx) => `
          <div class="account-item">
            <div class="account-info">
              <strong>${acc.name || 'Untitled Account'}</strong>
              <span class="account-type">${acc.type}</span>
            </div>
            <div class="account-actions">
              <button class="account-edit-btn save-btn" style="padding: 4px 10px; font-size: 12px;" data-index="${idx}">Edit</button>
              <button class="account-delete-btn cancel-btn" style="padding: 4px 10px; font-size: 12px; margin-left: 4px;" data-index="${idx}">Delete</button>
            </div>
          </div>
        `).join('')}
        ${accounts.length === 0 ? '<p style="color: #999; text-align: center; padding: 20px;">No accounts configured. Add one below.</p>' : ''}
      </div>
      
      <button id="add-account-btn" class="add-account-btn">+ Add Account</button>
      
      <div id="account-form" class="account-form" style="display: none; border-top: 1px solid #333; margin-top: 20px; padding-top: 20px;">
        <h3>Add/Edit Account</h3>
        <form id="account-form-content">
          <input type="hidden" id="account-index" value="-1" />
          <div class="form-group">
            <label>Name</label>
            <input type="text" id="account-name" required />
          </div>
          <div class="form-group">
            <label>Type</label>
            <select id="account-type" required>
              <option value="openai">OpenAI</option>
              <option value="groq">Groq</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          <div class="form-group" id="api-key-group">
            <label>API Key</label>
            <input type="password" id="account-api-key" placeholder="Enter your key (will be masked)" />
          </div>
          <div class="form-group">
            <label>Model</label>
            <input type="text" id="account-model" placeholder="e.g. gpt-4o, llama-3-70b" required />
          </div>
          <div class="form-actions">
            <button type="submit" class="save-btn">Save Account</button>
            <button type="button" id="cancel-account-form" class="cancel-btn">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  renderVoiceTab() {
    const settings = this.config.settings || {};
    return `
      <div class="form-group">
        <h3>Microphone</h3>
        <div class="form-group">
          <label>Input Device:</label>
          <select id="voice-device-id">
            <option value="default">Default Microphone</option>
          </select>
          <small id="mic-perm-warning" style="color: #888; display: block; margin-top: 4px;">Permission granted after first assistant start.</small>
        </div>
        <div class="form-group" style="padding: 10px; background: #1a1a1a; border-radius: 6px; margin-bottom: 20px;">
          <label style="display: flex; justify-content: space-between;">
            <span>Test Microphone</span>
            <span id="mic-test-status" style="color: #999; font-weight: normal;">Not Testing</span>
          </label>
          <div style="display: flex; gap: 10px; align-items: center; margin-top: 8px;">
             <button id="btn-test-mic" class="save-btn" style="padding: 6px 12px; font-size: 12px; background: #333;">Start Test</button>
             <div style="flex: 1; height: 10px; background: #000; border-radius: 5px; position: relative; overflow: hidden;">
                <div id="mic-test-bar" style="height: 100%; width: 0%; background: #4a9eff; transition: width 0.1s ease;"></div>
             </div>
          </div>
        </div>
      </div>

      <div class="form-group">
        <h3>Voice Settings</h3>
        <div class="form-group">
          <label>Speech Recognition API:</label>
          <select id="voice-api">
            <option value="groq-whisper" ${settings.voiceAPI === 'groq-whisper' ? 'selected' : ''}>Groq Whisper</option>
            <option value="openai-whisper" ${settings.voiceAPI === 'openai-whisper' ? 'selected' : ''}>OpenAI Whisper</option>
          </select>
        </div>
        <div class="form-group">
          <label>Whisper Model:</label>
          <select id="whisper-model">
            <option value="whisper-large-v3-turbo" ${settings.whisperModel === 'whisper-large-v3-turbo' ? 'selected' : ''}>whisper-large-v3-turbo</option>
            <option value="whisper-1" ${settings.whisperModel === 'whisper-1' ? 'selected' : ''}>whisper-1</option>
          </select>
        </div>
        <div class="form-group">
          <label style="display: flex; justify-content: space-between;">
            <span>Sensitivity</span>
            <span id="sensitivity-value">${settings.voiceSensitivity || -85}dB</span>
          </label>
          <input type="range" id="voice-sensitivity" min="-95" max="-30" value="${settings.voiceSensitivity || -85}" />
        </div>
        <div class="form-group">
          <label style="display: flex; justify-content: space-between;">
            <span>Silence Threshold (ms)</span>
            <span id="silence-threshold-value">${settings.voiceSilenceThreshold || 250}ms</span>
          </label>
          <input type="range" id="voice-silence-threshold" min="50" max="2000" step="50" value="${settings.voiceSilenceThreshold || 250}" />
        </div>
        
        <div class="form-group" style="padding: 10px; background: #1a1a1a; border-radius: 6px;">
          <label>AI Voice Output</label>
          <div style="margin-top: 8px;">
             <button id="btn-test-voice" class="save-btn" style="padding: 6px 12px; font-size: 12px; background: #333;">Test AI Voice</button>
             <small style="color: #888; font-size: 11px; margin-left: 10px;">Ensures your speakers are working.</small>
          </div>
        </div>
      </div>
      <div class="settings-actions">
        <button id="save-voice-settings" class="save-btn">Save Voice Settings</button>
      </div>
    `;
  }

  renderPrivacyTab() {
    const settings = this.config.settings || {};
    return `
      <div class="form-group">
        <h3>Privacy</h3>
        <div class="form-group" style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="auto-blur" style="width: auto;" ${settings.autoBlur ? 'checked' : ''} />
          <label style="margin-bottom: 0;">Blur chat when window loses focus</label>
        </div>
        <div class="form-group">
          <label>Auto-lock after (minutes):</label>
          <input type="number" id="auto-lock-minutes" value="${settings.autoLockMinutes || 15}" min="1" />
        </div>
        <div class="form-group">
          <label>Message retention (days, 0 = never delete):</label>
          <input type="number" id="message-retention" value="${settings.messageRetentionDays || 0}" min="0" />
        </div>
      </div>
      <div class="settings-actions">
        <button id="save-privacy-settings" class="save-btn">Save Privacy Settings</button>
      </div>
    `;
  }

  renderGeneralTab() {
    const settings = this.config.settings || {};
    return `
      <div class="form-group">
        <h3>Shortcuts</h3>
        <div class="form-group">
          <label>Hide/Show App Shortcut:</label>
          <input type="text" id="hide-shortcut" value="${settings.hideShortcut || 'Ctrl+Alt+H'}" />
        </div>
        <div class="form-group">
          <label>Ghost Type Shortcut (Paste):</label>
          <input type="text" id="ghost-shortcut" value="${settings.ghostShortcut || 'Ctrl+Alt+V'}" />
        </div>
      </div>
      <div class="form-group">
        <h3>About</h3>
        <p style="color: #999; font-size: 14px;">Noctisai v1.0.1</p>
        <p style="color: #777; font-size: 12px;">Secure local AI interviewer helper.</p>
      </div>
      <div class="settings-actions">
        <button id="save-general-settings" class="save-btn">Save General Settings</button>
      </div>
    `;
  }

  async refreshMicrophoneChoices() {
    const deviceSelect = document.getElementById('voice-device-id');
    if (!deviceSelect) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === 'audioinput');
      console.log('[SettingsPanel] Mics found:', mics.length);
      
      const voiceSettings = this.config?.settings || {};
      const currentValue = deviceSelect.value || voiceSettings.voiceDeviceId || 'default';
      
      let html = mics.map(m => `
        <option value="${m.deviceId}" ${m.deviceId === currentValue ? 'selected' : ''}>
          ${m.label || (m.deviceId === 'default' ? 'System Default' : 'Microphone ' + m.deviceId.slice(0, 5))}
        </option>
      `).join('');
      
      if (mics.length === 0 || !html) {
        html = `<option value="default" ${currentValue === 'default' ? 'selected' : ''}>Default Microphone</option>`;
      }
      
      deviceSelect.innerHTML = html;
    } catch (err) {
      console.error('Failed to enumerate microphones:', err);
    }
  }

  /**
   * Setup form handlers
   */
  setupFormHandlers() {
    // Tab switching
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        
        // Update state
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        document.querySelectorAll('.settings-tab-content').forEach(c => c.style.display = 'none');
        document.getElementById(`${tabName}-tab`).style.display = 'block';

        if (tabName === 'voice') {
          this.refreshMicrophoneChoices();
        }
      });
    });

    // Save buttons
    document.getElementById('save-general-settings')?.addEventListener('click', () => this.savePrivacySettings());
    document.getElementById('save-privacy-settings')?.addEventListener('click', () => this.savePrivacySettings());
    document.getElementById('save-voice-settings')?.addEventListener('click', () => this.saveVoiceSettings());

    // Mic Test Logic
    let micTestStream = null;
    let micTestInterval = null;
    const testMicBtn = document.getElementById('btn-test-mic');
    
    testMicBtn?.addEventListener('click', async (e) => {
        const btn = e.target;
        const bar = document.getElementById('mic-test-bar');
        const status = document.getElementById('mic-test-status');

        if (micTestStream) {
            micTestStream.getTracks().forEach(t => t.stop());
            micTestStream = null;
            if (micTestInterval) clearInterval(micTestInterval);
            if (bar) bar.style.width = '0%';
            if (status) status.innerText = 'Not Testing';
            btn.innerText = 'Start Test';
            return;
        }

        try {
            const deviceId = document.getElementById('voice-device-id').value;
            micTestStream = await navigator.mediaDevices.getUserMedia({
                audio: { 
                  deviceId: deviceId === 'default' ? undefined : { exact: deviceId },
                  autoGainControl: true
                }
            });
            
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') await audioCtx.resume();
            
            const analyser = audioCtx.createAnalyser();
            const source = audioCtx.createMediaStreamSource(micTestStream);
            source.connect(analyser);
            analyser.fftSize = 256;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            btn.innerText = 'Stop Test';
            if (status) status.innerText = 'Testing...';

            micTestInterval = setInterval(() => {
                analyser.getByteFrequencyData(dataArray);
                let max = 0;
                for (let i = 0; i < bufferLength; i++) {
                  if (dataArray[i] > max) max = dataArray[i];
                }
                // Calculate a more sensitive percentage (max is 0-255)
                // Using 100 as the 'loud' marker for better visual feedback with quiet mics
                const volume = Math.min(100, (max / 100) * 100);
                if (bar) bar.style.width = volume + '%';
            }, 30);
        } catch (err) {
            console.error('Test failed:', err);
            alert('Mic error: ' + err.message);
        }
    });

    // Voice Test Logic
    document.getElementById('btn-test-voice')?.addEventListener('click', () => {
        if (!window.speechSynthesis) return alert('No TTS support');
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance("Microphone check, one two. This is the Voice Assistant testing your audio output.");
        window.speechSynthesis.speak(utterance);
    });

    // Sensitivity/Silence real-time labels
    const sensitivity = document.getElementById('voice-sensitivity');
    const silence = document.getElementById('voice-silence-threshold');
    
    sensitivity?.addEventListener('input', (e) => {
        const el = document.getElementById('sensitivity-value');
        if (el) el.innerText = e.target.value + 'dB';
    });
    silence?.addEventListener('input', (e) => {
        const el = document.getElementById('silence-threshold-value');
        if (el) el.innerText = e.target.value + 'ms';
    });
    
    // AI Accounts logic (delegated)
    document.getElementById('add-account-btn')?.addEventListener('click', () => {
        document.getElementById('account-form').style.display = 'block';
        document.getElementById('account-index').value = '-1';
        document.getElementById('account-name').value = '';
    });

    document.getElementById('cancel-account-form')?.addEventListener('click', () => {
        document.getElementById('account-form').style.display = 'none';
    });

    document.getElementById('account-form-content')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveAccount();
    });

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('account-edit-btn')) {
            const idx = e.target.dataset.index;
            const acc = this.config.accounts[idx];
            document.getElementById('account-index').value = idx;
            document.getElementById('account-name').value = acc.name || '';
            document.getElementById('account-type').value = acc.type || 'openai';
            document.getElementById('account-model').value = acc.model || '';
            document.getElementById('account-form').style.display = 'block';
        }
        if (e.target.classList.contains('account-delete-btn')) {
            if (confirm('Delete this account?')) {
                this.config.accounts.splice(e.target.dataset.index, 1);
                this.saveConfig().then(() => { this.hide(); this.show(); });
            }
        }
    });

    // Provider type change in form
    document.getElementById('account-type')?.addEventListener('change', (e) => {
        this.updateModelDropdown(e.target.value);
    });
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
  /**
   * Save privacy settings
   */
  async savePrivacySettings() {
    if (!this.config.settings) {
      this.config.settings = {};
    }

    const autoLock = document.getElementById('auto-lock');
    if (autoLock) this.config.settings.autoLock = autoLock.checked;

    const autoLockMinutes = document.getElementById('auto-lock-minutes');
    if (autoLockMinutes) this.config.settings.autoLockMinutes = parseInt(autoLockMinutes.value);

    const autoBlur = document.getElementById('auto-blur');
    if (autoBlur) this.config.settings.autoBlur = autoBlur.checked;

    const messageRetention = document.getElementById('message-retention');
    if (messageRetention) this.config.settings.messageRetentionDays = parseInt(messageRetention.value);

    // Save shortcuts
    const shortcutInput = document.getElementById('hide-shortcut');
    if (shortcutInput) {
      const newShortcut = shortcutInput.value.trim();
      if (newShortcut && this.config.settings.hideShortcut !== newShortcut) {
        this.config.settings.hideShortcut = newShortcut;
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

    await this.saveConfig();
    alert('Privacy settings saved');
  }

  /**
   * Save voice settings
   */
  async saveVoiceSettings() {
    if (!this.config.settings) {
      this.config.settings = {};
    }

    const voiceEnabledCheckbox = document.getElementById('voice-enabled');
    if (voiceEnabledCheckbox) {
      this.config.settings.voiceEnabled = voiceEnabledCheckbox.checked;
    }

    const voiceAPIEl = document.getElementById('voice-api');
    if (voiceAPIEl) {
      this.config.settings.voiceAPI = voiceAPIEl.value;
    }

    const whisperModelEl = document.getElementById('whisper-model');
    if (whisperModelEl) {
      this.config.settings.whisperModel = whisperModelEl.value;
    }

    const voiceSensitivity = document.getElementById('voice-sensitivity');
    if (voiceSensitivity) {
      this.config.settings.voiceSensitivity = parseInt(voiceSensitivity.value);
    }

    const voiceSilenceThreshold = document.getElementById('voice-silence-threshold');
    if (voiceSilenceThreshold) {
      this.config.settings.voiceSilenceThreshold = parseInt(voiceSilenceThreshold.value);
    }
    
    const voiceDeviceId = document.getElementById('voice-device-id');
    if (voiceDeviceId) {
      this.config.settings.voiceDeviceId = voiceDeviceId.value;
    }

    await this.saveConfig();
    alert('Voice settings saved');
    this.refreshMicrophoneChoices();
  }



  /**
   * Setup UI events for real-time updates (like range values)
   */
  setupRealTimeListeners() {
    const sensitivityRange = document.getElementById('voice-sensitivity');
    const sensitivityLabel = document.getElementById('sensitivity-value');
    if (sensitivityRange && sensitivityLabel) {
      sensitivityRange.oninput = (e) => {
        sensitivityLabel.innerText = `${e.target.value}dB`;
      };
    }

    const silenceRange = document.getElementById('voice-silence-threshold');
    const silenceLabel = document.getElementById('silence-threshold-value');
    if (silenceRange && silenceLabel) {
      silenceRange.oninput = (e) => {
        silenceLabel.innerText = `${e.target.value}ms`;
      };
    }
  }

  /**
   * Refresh microphone choices (Speech-to-Text)
   */
  async refreshMicrophoneChoices() {
    const micSelect = document.getElementById('voice-device-id');
    const warning = document.getElementById('mic-perm-warning');
    if (!micSelect) return;

    try {
      // Check for available devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');

      // Clear existing options except default
      micSelect.innerHTML = '<option value="default">Default System Microphone</option>';

      // Only show full labels if permission was already granted previously
      // Note: Labels might be empty until first getUserMedia call in some browsers
      audioInputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Microphone ${index + 1} (${device.deviceId.substring(0, 5)}...)`;
        micSelect.appendChild(option);
      });

      // Restore saved selection
      const savedDeviceId = this.config?.settings?.voiceDeviceId || 'default';
      micSelect.value = savedDeviceId;

      if (audioInputs.some(input => !input.label)) {
        if (warning) warning.innerText = 'Labels missing. Start the Assistant once to grant mic permissions, then re-open settings to select specific devices.';
      }

    } catch (error) {
      console.error('Failed to enumerate audio devices:', error);
    }
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

