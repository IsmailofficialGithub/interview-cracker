/**
 * Real-Time Voice Assistant
 * Supports two modes:
 * 1. MINE MODE: Microphone input, user speaking directly
 * 2. YOURS MODE: System audio/environment audio capture
 */

class VoiceAssistant {
  constructor() {
    this.mode = 'mine'; // 'mine' or 'yours'
    this.isActive = false;
    this.isProcessing = false;

    // Initialize logging panel if available
    // this.initLogs(); // Note: method does not exist in this file

    console.log('[VoiceAssistant] Constructor initialized. Mode: mine');
    this.loadConfig().then(() => {
      console.log('[VoiceAssistant] Initial config loaded. Accounts count:', this.config?.accounts?.length || 0);
    });

    // Audio capture
    this.mediaRecorder = null;
    this.audioStream = null;
    this.audioChunks = [];
    this.recordingInterval = null;
    this.transcriptionInterval = null;

    // Configuration
    this.config = null;
    this.currentProvider = null;
    this.whisperProvider = null;
    this.whisperModel = null;
    this.whisperApiKey = null;

    // State
    this.lastTranscription = '';
    this.responseBuffer = '';
    this.lastProcessedChunkIndex = 0; // Track which chunks have been processed
    this.lastTranscriptionTime = 0; // For debouncing
    this.recentTranscriptions = []; // Track recent transcriptions to avoid duplicates

    // Chat integration
    this.chatUI = null; // Reference to ChatUI instance

    // UI elements
    this.statusIndicator = null;
    this.modeButton = null;
    this.startButton = null;

    // Callbacks
    this.onTranscription = null;
    this.onResponse = null;
    this.onError = null;

    // Internal state for debouncing/throttling
    this.isToggling = false;
    this.lastErrorTime = 0;
    this.lastErrorMessage = '';

    // Voice Activity Detection (VAD)
    this.audioContext = null;
    this.analyserNode = null;
    this.voiceActivityCheckInterval = null;
    this.isSpeaking = false;
    this.silenceStartTime = null;
    this.silenceDurationThreshold = 600; // Increased to 600ms for more natural pauses
    this.speechThreshold = -70;  // EXTREMELY low to detect very quiet microphones
    this.silenceThreshold = -80; // Even lower to distinguish from background noise
    this.minRecordingDuration = 50; // Minimal buffer for ultra-fast reaction
    this.maxRecordingDuration = 30000; // Maximum 30 seconds of recording
    this.recordingStartTime = null;
    this.accumulatedChunks = []; // Store chunks while speaking
  }

  /**
   * Initialize the voice assistant
   * @param {ChatUI} chatUI - Reference to ChatUI instance for message history
   */
  async initialize(chatUI = null) {
    this.chatUI = chatUI;
    await this.loadConfig();
    this.setupUI();

    // Register global toggle handler for index.html/other UI parts to call
    window.handleVoiceModeToggle = async (mode) => {
      console.log('[VoiceAssistant] Global toggle handler called:', mode);
      await this.setMode(mode);
    };

    console.log('[VoiceAssistant] Initialized and global toggle handler attached');
  }

  /**
   * Load configuration
   */
  async loadConfig() {
    try {
      const result = await window.electronAPI.getConfig();
      if (result.success) {
        this.config = result.data || { accounts: [], settings: {} };
        console.log('[VoiceAssistant] Config loaded successfully:', {
          hasAccounts: !!this.config.accounts && this.config.accounts.length > 0,
          accountsCount: this.config.accounts ? this.config.accounts.length : 0,
          settings: this.config.settings
        });

        // Get settings (user's preference)
        const settings = this.config.settings || {};
        const voiceAPI = settings.voiceAPI || 'groq-whisper'; // Default to Groq Whisper

        // Update silence duration threshold from user settings
        this.silenceDurationThreshold = settings.voiceSilenceThreshold || 600;

        // FIXED: Use hardcoded reliable thresholds.
        // The settings slider was saving wrong values (e.g. -37 dB which is WAY too high).
        // A typical mic at normal speaking volume registers around -30 to -50 dB peak.
        // We set the silence floor at -60 dB to catch quiet mics reliably.
        this.silenceThreshold = -60;  // Below this = silence
        this.speechThreshold = -50;  // Above this = speech detected

        console.log('[VoiceAssistant] VAD Config Loaded:', {
          duration: `${this.silenceDurationThreshold}ms`,
          silenceDbThreshold: `${this.silenceThreshold}dB`,
          speechDbThreshold: `${this.speechThreshold}dB`
        });

        console.log('[VoiceAssistant] Voice API setting:', voiceAPI);

        // Find accounts
        const accounts = this.config.accounts || [];
        const groqAccount = accounts.find(a => a.type === 'groq');
        const openaiAccount = accounts.find(a => a.type === 'openai');

        // Set whisper provider based on user's voiceAPI setting, not which account exists first
        if (voiceAPI === 'openai-whisper' || voiceAPI === 'openai') {
          // User wants OpenAI Whisper
          if (openaiAccount) {
            this.whisperProvider = 'openai';
            this.whisperApiKey = openaiAccount.apiKey;
            this.whisperModel = 'whisper-1';
            console.log('[VoiceAssistant] Using OpenAI Whisper for transcription');
          } else {
            console.warn('[VoiceAssistant] OpenAI Whisper selected but no OpenAI account found, falling back to Groq');
            if (groqAccount) {
              this.whisperProvider = 'groq';
              this.whisperApiKey = groqAccount.apiKey;
              this.whisperModel = 'whisper-large-v3-turbo';
            }
          }
        } else {
          // Default to Groq Whisper (groq-whisper or any other value)
          if (groqAccount) {
            this.whisperProvider = 'groq';
            this.whisperApiKey = groqAccount.apiKey;
            this.whisperModel = 'whisper-large-v3-turbo';
            console.log('[VoiceAssistant] Using Groq Whisper for transcription');
          } else if (openaiAccount) {
            console.warn('[VoiceAssistant] Groq Whisper selected but no Groq account found, falling back to OpenAI');
            this.whisperProvider = 'openai';
            this.whisperApiKey = openaiAccount.apiKey;
            this.whisperModel = 'whisper-1';
          }
        }

        // Set currentProvider for LLM (this is now handled by chat selection, but keep for fallback)
        if (groqAccount) {
          this.currentProvider = 'groq';
        } else if (openaiAccount) {
          this.currentProvider = 'openai';
        }
      } else {
        console.error('[VoiceAssistant] Failed to load config: result.success is false');
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  /**
   * Setup UI elements
   */
  setupUI() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupUI());
      return;
    }

    // Use setTimeout to ensure DOM is fully rendered
    setTimeout(() => {
      // Create status indicator if it doesn't exist
      let statusEl = document.getElementById('voice-assistant-status');
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'voice-assistant-status';
        statusEl.className = 'voice-assistant-status';
        document.body.appendChild(statusEl);
      }
      this.statusIndicator = statusEl;

      // Find or create mode toggle switch (should already exist in HTML)
      let modeToggle = document.getElementById('voice-mode-toggle');
      if (!modeToggle) {
        // Create if it doesn't exist
        console.log('[VoiceAssistant] Mode toggle missing from DOM, creating new one...');
        modeToggle = this.createModeToggle();

        // Try multiple selectors to find input area
        let inputArea = document.querySelector('.input-area');
        if (!inputArea) {
          inputArea = document.getElementById('message-input')?.parentElement;
        }
        if (!inputArea) {
          const inputAreas = document.getElementsByClassName('input-area');
          if (inputAreas.length > 0) {
            inputArea = inputAreas[0];
          }
        }

        if (inputArea) {
          inputArea.insertBefore(modeToggle, inputArea.firstChild);
          console.log('[VoiceAssistant] Mode toggle switch created and added to input area');
        } else {
          console.error('[VoiceAssistant] Could not find input area to insert mode toggle switch');
        }
      }
      else {
        console.log('[VoiceAssistant] Mode toggle switch found in DOM, ensuring handlers are attached');
        // Re-attach or ensure onclick handlers are present on static HTML elements
        const mine = modeToggle.querySelector('[data-mode="mine"]');
        const yours = modeToggle.querySelector('[data-mode="yours"]');
        if (mine) mine.onclick = () => window.handleVoiceModeToggle('mine');
        if (yours) yours.onclick = () => window.handleVoiceModeToggle('yours');
      }

      this.modeButton = modeToggle;

      // Use GLOBAL EVENT DELEGATION for maximum robustness
      // This works even if renderer-bundle.js replaces the chat area in the DOM
      if (!window._voiceAssistantListenersAttached) {
        document.addEventListener('click', async (e) => {
          // Handle Start/Stop button clicks (Global Delegation)
          const listenBtn = e.target.closest('#listen-button');
          if (listenBtn) {
            console.log('[VoiceAssistant] Global start/stop click detected');
            e.preventDefault();
            e.stopPropagation();
            await this.toggle();
            return;
          }

          // Handle Mode Toggle (MINE/YOURS) clicks (Global Delegation)
          const toggleOpt = e.target.closest('.toggle-option');
          if (toggleOpt) {
            const mode = toggleOpt.getAttribute('data-mode');
            if (mode) {
              console.log('[VoiceAssistant] Global mode toggle click detected:', mode);
              e.preventDefault();
              e.stopPropagation();
              if (window.handleVoiceModeToggle) {
                window.handleVoiceModeToggle(mode);
              } else {
                this.setMode(mode); // fallback straight to instance
              }
            }
            return;
          }
        }, true); // Use capture phase

        // Listen for configuration updates from Settings
        window.addEventListener('config-updated', async () => {
          console.log('[VoiceAssistant] Config update detected, reloading...');
          await this.loadConfig();
        });

        window._voiceAssistantListenersAttached = true;
      }

      // Initial state sync
      this.updateUI();
    }, 200);
  }

  /**
   * Toggle between MINE and YOURS modes
   */
  async toggleMode() {
    console.log('toggleMode called, current mode:', this.mode, 'isActive:', this.isActive);

    if (this.isActive) {
      console.log('Stopping voice assistant before mode switch');
      await this.stop();
    }

    // Toggle mode
    this.mode = this.mode === 'mine' ? 'yours' : 'mine';
    console.log('Mode switched to:', this.mode);

    // Update UI
    this.updateUI();
  }

  /**
   * Set mode directly
   */
  async setMode(mode) {
    if (mode !== 'mine' && mode !== 'yours') {
      console.error('Invalid mode:', mode);
      return;
    }

    console.log('setMode called, current mode:', this.mode, 'new mode:', mode, 'isActive:', this.isActive);

    if (this.isActive) {
      console.log('Stopping voice assistant before mode switch');
      await this.stop();
    }

    this.mode = mode;
    console.log('Mode set to:', this.mode);

    // Update UI
    this.updateUI();
  }

  /**
   * Update UI based on current state
   */
  updateUI() {
    console.log(`[VoiceAssistant] updateUI: mode=${this.mode}, active=${this.isActive}`);

    // 1. Ensure the toggle is in the ACTIVE DOM
    let modeToggle = document.getElementById('voice-mode-toggle');
    const inputArea = document.querySelector('.input-area') || document.querySelector('.chat-input-area') ||
      (document.getElementById('message-input')?.parentElement);

    if (inputArea) {
      if (!modeToggle) {
        // Create if it doesn't exist
        console.log('[VoiceAssistant] Re-creating missing toggle...');
        modeToggle = this.createModeToggle();
        inputArea.insertBefore(modeToggle, inputArea.firstChild);
        if (typeof feather !== 'undefined') {
          feather.replace(); // Initialize icons for newly created toggle
        }
      } else if (modeToggle.parentElement !== inputArea) {
        // Move if it's in a detached/wrong parent (from a previous re-render)
        console.log('[VoiceAssistant] Re-injecting toggle into new input area...');
        inputArea.insertBefore(modeToggle, inputArea.firstChild);
      }
    }

    if (modeToggle) {
      this.modeButton = modeToggle;
      // Update visual state
      const toggleOptions = modeToggle.querySelectorAll('.toggle-option');

      if (this.mode === 'yours') {
        modeToggle.classList.add('yours-mode');
      } else {
        modeToggle.classList.remove('yours-mode');
      }

      toggleOptions.forEach(option => {
        const optMode = option.getAttribute('data-mode');
        if (optMode === this.mode) {
          option.classList.add('active');
        } else {
          option.classList.remove('active');
        }
      });

      // Re-initialize icons if needed
      if (typeof feather !== 'undefined') {
        feather.replace();
      }
    }

    // 2. Update Start/Stop button
    const listenButton = document.getElementById('listen-button');
    if (listenButton) {
      this.startButton = listenButton;
      if (this.isActive) {
        listenButton.classList.add('active');
        listenButton.innerHTML = `<i data-feather="stop-circle" class="icon"></i> Stop Assistant`;
      } else {
        listenButton.classList.remove('active');
        listenButton.innerHTML = `<i data-feather="mic" class="icon"></i> Start Assistant`;
      }

      // Re-initialize icons
      if (typeof feather !== 'undefined') {
        feather.replace();
      }
    }

    this.updateStatus();
  }

  /**
   * Helper to create the toggle element
   */
  createModeToggle() {
    const modeToggle = document.createElement('div');
    modeToggle.id = 'voice-mode-toggle';
    modeToggle.className = 'voice-mode-toggle';
    modeToggle.innerHTML = `
      <span class="toggle-option ${this.mode === 'mine' ? 'active' : ''}" data-mode="mine" onclick="if(window.handleVoiceModeToggle) window.handleVoiceModeToggle('mine')">
        <i data-feather="mic" class="icon"></i> MINE
      </span>
      <span class="toggle-option ${this.mode === 'yours' ? 'active' : ''}" data-mode="yours" onclick="if(window.handleVoiceModeToggle) window.handleVoiceModeToggle('yours')">
        <i data-feather="volume-2" class="icon"></i> YOURS
      </span>
    `;
    modeToggle.title="";
    return modeToggle;
  }

  /**
   * Update status indicator
   */
  updateStatus() {
    if (!this.statusIndicator) return;

    if (this.isActive) {
      const iconName = this.mode === 'mine' ? 'mic' : 'volume-2';
      this.statusIndicator.className = 'voice-assistant-status active';

      // Select appropriate status text
      let statusText = 'Listening...';
      if (this.isProcessing) {
        statusText = this.responseBuffer ? 'Responding...' : 'Thinking...';
      } else if (this.isSpeaking) {
        statusText = '<span style="color: #4aff4a; animation: pulse 0.5s infinite;">Hearing you...</span>';
      } else if (this._hasAudioSinceLastLoop) {
        statusText = '<span style="color: #88ff88;">Hearing noise...</span>';
      }

      let content = `
        <div class="status-mode">
          <i data-feather="${iconName}" class="icon icon-small"></i> ${this.mode === 'mine' ? 'MINE MODE' : 'YOURS MODE'}
        </div>
        <div class="status-text">${statusText}</div>
      `;

      // Show AI response if available, otherwise show transcription
      if (this.responseBuffer) {
        content += `<div class="status-response">${this.responseBuffer}</div>`;
      } else if (this.lastTranscription) {
        content += `<div class="status-transcript">${this.lastTranscription}</div>`;
      }

      this.statusIndicator.innerHTML = content;

      // Re-initialize icons
      if (typeof feather !== 'undefined') {
        feather.replace();
      }

      // Ensure transcript/response scrolls to bottom
      const transcript = this.statusIndicator.querySelector('.status-transcript');
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
      const response = this.statusIndicator.querySelector('.status-response');
      if (response) response.scrollTop = response.scrollHeight;

    } else {
      this.statusIndicator.className = 'voice-assistant-status';
      this.statusIndicator.innerHTML = '';
      this.responseBuffer = ''; // Clear buffer when stopped
    }
  }

  /**
   * Toggle voice assistant on/off
   */
  async toggle() {
    if (this.isToggling) {
      console.log('Toggle ignored - already processing toggle');
      return;
    }

    this.isToggling = true;
    console.log('Toggle called, isActive:', this.isActive, 'mode:', this.mode);

    try {
      if (this.isActive) {
        console.log('Stopping voice assistant...');
        await this.stop();
      } else {
        console.log('Starting voice assistant...');
        await this.start();
      }
    } catch (error) {
      console.error('Error during toggle:', error);
      this.showError(`Toggle error: ${error.message}`);
    } finally {
      // Add a small delay before allowing another toggle to prevent double-clicks
      setTimeout(() => {
        this.isToggling = false;
      }, 500);
    }
  }

  /**
   * Start voice assistant
   */
  async start() {
    if (this.isActive) {
      console.log('Voice assistant already active');
      return;
    }

    if (!this.whisperApiKey) {
      this.showError('No API key configured. Please configure Groq or OpenAI in Settings.');
      return;
    }

    try {
      console.log(`[VoiceAssistant] START called - mode: ${this.mode}`);
      this.isActive = true;
      this.lastProcessedChunkIndex = 0; // Reset chunk tracking
      this.audioChunks = []; // Clear any old chunks
      this.updateUI();

      if (this.mode === 'mine') {
        console.log('[VoiceAssistant] Entering MINE mode flow');
        await this.startMineMode();
      } else {
        console.log('[VoiceAssistant] Entering YOURS mode flow');
        await this.startYoursMode();
      }
      console.log(`[VoiceAssistant] Successfully started in ${this.mode} mode`);
    } catch (error) {
      console.error('[VoiceAssistant] CRITICAL: Failed to start voice assistant:', error);
      this.showError(`Failed to start: ${error.message}`);
      this.isActive = false;
      this.updateUI();
    }
  }

  /**
   * Stop voice assistant
   */
  async stop() {
    if (!this.isActive) return;

    this.isActive = false;
    this.isProcessing = false;

    // Stop VAD checking
    if (this.voiceActivityCheckInterval) {
      clearInterval(this.voiceActivityCheckInterval);
      this.voiceActivityCheckInterval = null;
    }

    // Clear chunk auto-stop timer
    if (this._chunkTimer) {
      clearTimeout(this._chunkTimer);
      this._chunkTimer = null;
    }

    // Clear YOURS mode silence timer
    if (this._yoursSilenceTimer) {
      clearTimeout(this._yoursSilenceTimer);
      this._yoursSilenceTimer = null;
    }
    this._yoursRecording = false;

    // Stop recording
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    // Stop intervals
    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
      this.recordingInterval = null;
    }

    if (this.transcriptionInterval) {
      clearInterval(this.transcriptionInterval);
      this.transcriptionInterval = null;
    }

    // Close AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch (error) {
        console.warn('Error closing AudioContext:', error);
      }
      this.audioContext = null;
      this.analyserNode = null;
    }

    // Stop audio stream
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }

    this.mediaRecorder = null;
    this.audioChunks = [];
    this.accumulatedChunks = [];
    this.lastProcessedChunkIndex = 0;
    this.isSpeaking = false;
    this.silenceStartTime = null;
    this.recordingStartTime = null;
    this.updateUI();
  }

  /**
   * Start MINE mode (microphone input ONLY - no system audio)
   */
  async startMineMode() {
    try {
      // Ensure window stays on top and focused before requesting permissions
      await this.ensureWindowOnTop();

      // Use user-selected device if available
      const deviceId = this.config?.settings?.voiceDeviceId || 'default';
      console.log(`[VoiceAssistant] Requesting microphone device: ${deviceId}`);

      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
          // Disable browser audio processing - Whisper handles noise filtering itself.
          // noiseSuppression can suppress quiet voices, treating them as background noise.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000,  // Whisper works best at 16kHz
        },
        video: false
      });

      // Verify we got microphone tracks only
      // Log audio tracks for debugging
      const audioTracks = this.audioStream.getAudioTracks();
      console.log('MINE mode: Audio tracks found:', audioTracks.length);
      audioTracks.forEach(track => {
        console.log(`[VoiceAssistant] Track Label: "${track.label}", ID: ${track.id}, Enabled: ${track.enabled}, ReadyState: ${track.readyState}`);
      });

      // Bring window back to front
      await this.ensureWindowOnTop();

      // Initialize chunk storage for the cycle
      this.currentCycleChunks = [];
      this.accumulatedChunks = [];

      // Create AudioContext for Voice Activity Detection
      try {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }
        const source = this.audioContext.createMediaStreamSource(this.audioStream);
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = 256;
        this.analyserNode.smoothingTimeConstant = 0.1; // Reduced from 0.8 for instant volume changes
        source.connect(this.analyserNode);
        console.log('AudioContext created for VAD in MINE mode');
      } catch (error) {
        console.error('Failed to create AudioContext for VAD:', error);
        // Continue without VAD if AudioContext fails
      }

      // Create MediaRecorder - detect supported mimeType
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        ''
      ];
      let selectedMime = '';
      for (const mime of mimeTypes) {
        if (mime === '' || MediaRecorder.isTypeSupported(mime)) {
          selectedMime = mime;
          console.log(`[VoiceAssistant] Using mimeType: "${mime || 'browser default'}"`);
          break;
        }
      }

      this.mediaRecorder = selectedMime
        ? new MediaRecorder(this.audioStream, { mimeType: selectedMime })
        : new MediaRecorder(this.audioStream);

      let chunkCount = 0;
      // Handle data available
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunkCount++;
          console.log(`[VoiceAssistant] Audio chunk #${chunkCount} received: ${event.data.size} bytes`);
          this.currentCycleChunks.push(event.data);
          this.accumulatedChunks.push(event.data);
        } else {
          console.warn('[VoiceAssistant] ondataavailable fired but data is empty!');
        }
      };

      // Handle stop - process the cycle's audio
      this.mediaRecorder.onstop = async () => {
        if (this.currentCycleChunks.length > 0) {
          const blob = new Blob(this.currentCycleChunks, { type: 'audio/webm' });
          this.currentCycleChunks = [];
          await this.processAudioBlob(blob);
        }
        // Restart immediately if still active — continuous chunked capture
        if (this.isActive) {
          this.startRecordingCycle();
        }
      };

      // Start VAD checking for UI feedback only (not gating)
      if (this.analyserNode) {
        this.voiceActivityCheckInterval = setInterval(() => {
          this.checkVoiceActivity();
        }, 100);
        console.log('[VoiceAssistant] VAD checking started (UI feedback only)');
      }

      // Start continuous recording — every 5 seconds we get a chunk
      this.startRecordingCycle();

    } catch (error) {
      console.error('Failed to start MINE mode:', error);
      throw new Error(`Microphone access denied: ${error.message}`);
    }
  }

  /**
   * VAD tick for YOURS mode — starts recording on speech, stops on silence
   */
  _yoursVADTick() {
    if (!this.analyserNode || !this.isActive || this.mode !== 'yours') return;

    try {
      const bufLen = this.analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufLen);
      this.analyserNode.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufLen; i++) sum += dataArray[i];
      const avg = sum / bufLen;

      // avg > 8 is a reasonable threshold for system audio speech vs silence/noise
      // Adjust this if needed — higher = only react to louder audio
      const speaking = avg > 8;

      if (speaking !== this.isSpeaking) {
        this.isSpeaking = speaking;
        this.updateStatus();
      }

      if (speaking) {
        // Cancel any pending silence timer
        if (this._yoursSilenceTimer) {
          clearTimeout(this._yoursSilenceTimer);
          this._yoursSilenceTimer = null;
        }

        // Start recording if not already
        if (!this._yoursRecording && this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
          this.currentCycleChunks = [];
          this._yoursRecording = true;
          try {
            this.mediaRecorder.start();
            console.log('[VoiceAssistant] YOURS VAD: Speech detected, recording started');
          } catch (e) {
            console.error('[VoiceAssistant] YOURS VAD: start() failed:', e.message);
            this._yoursRecording = false;
          }
        }
      } else {
        // Silence — start a timer to stop recording
        if (this._yoursRecording && !this._yoursSilenceTimer) {
          const silenceMs = this.silenceDurationThreshold || 1000;
          this._yoursSilenceTimer = setTimeout(() => {
            this._yoursSilenceTimer = null;
            if (this._yoursRecording && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
              console.log(`[VoiceAssistant] YOURS VAD: Silence for ${silenceMs}ms, stopping recording to process`);
              this.mediaRecorder.stop();
            }
          }, silenceMs);
        }
      }
    } catch (e) {
      // Ignore VAD errors
    }
  }

  /**
   * Check voice activity — used for UI feedback in MINE mode
   */
  async checkVoiceActivity() {
    if (!this.analyserNode || !this.isActive || this.mode !== 'mine') return;

    try {
      // Use FrequencyData for volume measurement
      const bufLen = this.analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufLen);
      this.analyserNode.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufLen; i++) sum += dataArray[i];
      const avg = sum / bufLen;
      // avg: 0-255. Scale to rough dB: 0 = -100dB, 255 = 0dB
      const volume = avg > 0 ? (avg / 255) * 100 - 100 : -100;

      const now = Date.now();
      if (!this._lastVolLogTime || now - this._lastVolLogTime > 2000) {
        console.log(`[VoiceAssistant] Mic level: ${avg.toFixed(1)}/255 (~${volume.toFixed(0)}dB equiv)`);
        this._lastVolLogTime = now;
      }

      // Simple speaking indicator: avg > 5 means some audio activity
      const speaking = avg > 5;
      if (speaking !== this.isSpeaking) {
        this.isSpeaking = speaking;
        this.updateStatus();
      }
    } catch (e) {
      // Ignore VAD errors
    }
  }


  /**
   * Stop recording and process accumulated audio
   */
  async stopRecordingAndProcess() {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
      return;
    }

    try {
      // Stop the recorder
      this.mediaRecorder.stop();

      // The onstop handler will process the audio
      // Reset state for next recording
      this.isSpeaking = false;
      this.silenceStartTime = null;
      this.recordingStartTime = null;
    } catch (error) {
      console.error('Error stopping recording:', error);
    }
  }

  // Start a timed recording cycle: record for 5 seconds, then auto-process
  startRecordingCycle() {
    if (!this.isActive || !this.mediaRecorder) return;
    if (this.mediaRecorder.state === 'recording') return;

    this.currentCycleChunks = [];
    this.recordingStartTime = Date.now();

    try {
      this.mediaRecorder.start();
      console.log(`[VoiceAssistant] Recording started — state: ${this.mediaRecorder.state}, mimeType: ${this.mediaRecorder.mimeType}`);
    } catch (e) {
      console.error('[VoiceAssistant] MediaRecorder.start() failed:', e.message);
      return;
    }

    // Auto-stop after 5 seconds to create a processable chunk
    this._chunkTimer = setTimeout(() => {
      if (this.isActive && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        console.log('[VoiceAssistant] 5s chunk complete, stopping to process...');
        this.mediaRecorder.stop();
      }
    }, 5000);
  }

  /**
   * Start YOURS mode (system/speaker audio ONLY - no microphone)
   */
  /**
   * Start YOURS mode (system/speaker audio ONLY - no microphone)
   */
  async startYoursMode() {
    console.log('[VoiceAssistant] Starting YOURS mode (System Audio)...');
    try {
      // Ensure window stays on top and focused
      await this.ensureWindowOnTop();

      // Request desktop/system audio capture ONLY
      let stream = null;

      try {
        console.log('[VoiceAssistant] YOURS: Attempting getDisplayMedia...');
        // video: true is REQUIRED for getDisplayMedia to work at all
        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            suppressLocalAudioPlayback: false,
            sampleRate: 44100
          },
          video: true // Required for getDisplayMedia
        });

        console.log('[VoiceAssistant] YOURS: getDisplayMedia returned stream:', stream.id);
        // We only care about audio, stop video trace immediately to save resources
        stream.getVideoTracks().forEach(track => {
          console.log('[VoiceAssistant] YOURS: Stopping video track:', track.label);
          track.stop();
        });
        console.log('YOURS: getDisplayMedia success');
      } catch (displayMediaError) {
        console.log('[VoiceAssistant] YOURS: getDisplayMedia failed, attempting desktopCapturer fallback...', displayMediaError);
        const sourcesResult = await window.electronAPI.getDesktopSources({ types: ['screen', 'window'] });
        console.log('[VoiceAssistant] YOURS: Desktop sources response:', sourcesResult);

        if (!sourcesResult.success || sourcesResult.sources.length === 0) {
          throw new Error('No system audio sources found. Please ensure screen recording permissions are granted.');
        }

        const sourceId = sourcesResult.sources[0].id;
        console.log('[VoiceAssistant] YOURS: Using source ID:', sourceId, 'Name:', sourcesResult.sources[0].name);

        // Electron-specific constraint syntax for desktopCapturer
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          },
          video: { // Mandatory for desktop capture
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          }
        });

        console.log('[VoiceAssistant] YOURS: desktopCapturer getUserMedia returned stream:', stream.id);
        // Stop video tracks
        stream.getVideoTracks().forEach(track => {
          console.log('[VoiceAssistant] YOURS: Stopping fallback video track:', track.label);
          track.stop();
        });
        console.log('YOURS: desktopCapturer fallback success');
      }

      // Verify audio tracks
      const audioTracks = stream.getAudioTracks();
      console.log('[VoiceAssistant] YOURS: Audio tracks found:', audioTracks.length);

      if (audioTracks.length === 0) {
        throw new Error('No audio tracks captured. This usually means "Share System Audio" was not checked in the screen share picker.');
      }

      // Store the stream
      this.audioStream = stream;

      // Create AudioContext for VAD (Volume detection)
      try {
        if (this.audioContext && this.audioContext.state !== 'closed') {
          await this.audioContext.close();
        }
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = this.audioContext.createMediaStreamSource(this.audioStream);
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = 256;
        this.analyserNode.smoothingTimeConstant = 0.1; // Reduced from 0.8 for instant volume changes
        source.connect(this.analyserNode);
        console.log('[VoiceAssistant] YOURS: AudioContext and AnalyserNode setup complete');
      } catch (vadError) {
        console.warn('[VoiceAssistant] YOURS: VAD setup failed:', vadError);
      }

      // Initialize chunk storage
      this.currentCycleChunks = [];
      this.accumulatedChunks = [];
      this._yoursRecording = false; // Are we actively recording speech?
      this._yoursSilenceTimer = null;

      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });

      // Collect chunks while recording
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.currentCycleChunks.push(event.data);
        }
      };

      // When recording stops, process the captured speech
      this.mediaRecorder.onstop = async () => {
        this._yoursRecording = false;
        if (this.currentCycleChunks.length > 0) {
          const blob = new Blob(this.currentCycleChunks, { type: mimeType });
          this.currentCycleChunks = [];
          if (blob.size >= 8000) { // Only send if there is real audio
            await this.processAudioBlob(blob);
          } else {
            console.log('[VoiceAssistant] YOURS: Blob too small after speech, discarding.');
          }
        }
      };

      // Start VAD-driven recording loop for YOURS mode
      if (this.analyserNode) {
        this.voiceActivityCheckInterval = setInterval(() => {
          this._yoursVADTick();
        }, 40);
        console.log('[VoiceAssistant] YOURS: VAD-gated recording started');
      } else {
        // No analyser - fall back to 10s cycles
        this.startRecordingCycle();
      }

      console.log('[VoiceAssistant] YOURS mode fully active');

    } catch (error) {
      console.error('[VoiceAssistant] Failed to start YOURS mode:', error);
      this.showError('YOURS Mode Initialization Failed: ' + error.message);
      await this.stop();
      throw error;
    }
  }

  /**
   * Process accumulated audio chunks
   */
  async processAudio() {
    if (this.audioChunks.length === 0) {
      console.log('[VoiceAssistant] No audio to process');
      return;
    }

    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
    this.audioChunks = [];
    console.log(`[VoiceAssistant] Processing audio blob: ${audioBlob.size} bytes`);

    // Sensitivity check
    if (audioBlob.size < 2000) { // Reduced from 5000 to be more sensitive
      console.log('[VoiceAssistant] Audio blob too small, skipping transcription');
      return;
    }

    await this.processAudioBlob(audioBlob);
  }

  /**
   * Send audio to transcription API
   */
  async processAudioBlob(audioBlob) {
    // If already processing, wait up to 2 seconds for it to finish before skipping
    // This handles cases where one sentence is being transcribed while another is being captured
    let waitCount = 0;
    while (this.isProcessing && waitCount < 10) {
      await new Promise(resolve => setTimeout(resolve, 200));
      waitCount++;
    }

    if (this.isProcessing) {
      console.warn('[VoiceAssistant] Still processing previous request after waiting, skipping to avoid congestion');
      return;
    }

    this.isProcessing = true;
    this.updateStatus();

    try {
      // CRITICAL: Check blob size before sending.
      // Silent/empty audio blobs are 2,000-5,000 bytes (just container overhead).
      // Real speech at 5 seconds is 15,000-80,000+ bytes.
      // Sending silence causes Whisper to hallucinate 'you'.
      const MIN_SPEECH_BLOB_SIZE = 8000; // bytes
      console.log(`[VoiceAssistant] Blob size: ${audioBlob.size} bytes (min: ${MIN_SPEECH_BLOB_SIZE})`);
      if (audioBlob.size < MIN_SPEECH_BLOB_SIZE) {
        console.log('[VoiceAssistant] Blob too small = silence detected, skipping transcription');
        this.isProcessing = false;
        this.updateStatus();
        return;
      }

      console.log('[VoiceAssistant] Starting transcription request...');
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Removed redundant loadConfig() to speed up processing loop

      const account = this.config.accounts?.find(acc =>
        (acc.type === 'openai' || acc.type === 'groq') && acc.apiKey
      );

      if (!account) {
        throw new Error('No API key found for Whisper transcription. Please add an OpenAI or Groq account in settings.');
      }

      console.log(`[VoiceAssistant] Using provider: ${account.type}, model: ${this.whisperModel || 'auto'}`);

      const transcriptionResult = await window.electronAPI.transcribeAudio(
        Array.from(uint8Array),
        account.apiKey,
        account.type,
        this.whisperModel || (account.type === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1')
      );

      console.log('[VoiceAssistant] Transcription result received:', transcriptionResult.success ? 'SUCCESS' : 'FAILED');
      if (!transcriptionResult.success) console.error('[VoiceAssistant] Transcription error detail:', transcriptionResult.error);

      if (transcriptionResult.success && transcriptionResult.text) {
        const text = transcriptionResult.text.trim();
        console.log('[VoiceAssistant] Transcription text:', JSON.stringify(text));

        // Only skip completely empty results
        if (text.length > 1) {
          this.lastTranscription = text;
          this.lastTranscriptionTime = Date.now();
          this.updateStatus();

          // Find input and send
          const input = this.chatUI?.inputArea || document.getElementById('message-input');
          const sendBtn = this.chatUI?.sendButton || document.getElementById('send-button');

          if (input && sendBtn) {
            input.value = text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(() => sendBtn.click(), 100);
          } else {
            console.warn('[VoiceAssistant] Could not find input/send button');
          }
        } else {
          console.log('[VoiceAssistant] Skipping empty/too-short transcription');
        }
      } else {
        console.warn('[VoiceAssistant] Transcription returned no text:', transcriptionResult);
      }

    } catch (error) {
      console.error('Failed to process audio blob:', error);
      // Suppress repeated validation errors from UI if they still happen occasionally
      if (!error.message.includes('valid media file')) {
        this.showError(`Transcription error: ${error.message}`);
      }
    } finally {
      this.isProcessing = false;
      this.updateStatus();
    }
  }

  // Kept for backward compatibility if called elsewhere, but we use processAudioBlob now
  async processAudioChunk() {
    // Deprecated in favor of stop-start cycle
  }

  isMeaningfulSpeech(text) {
    if (!text || text.length < 2) return false;

    // Filter out common transcription artifacts
    const noisePatterns = [
      /^[\s\.,!?\-]+$/,  // Only punctuation/whitespace
      /^(uh|um|ah|er|hmm|mm|huh|un|ugh|oh|uhm|mmm)+$/i,  // Only filler words
      /^[^\w\s]+$/,  // Only special characters
      /^(.)\1+$/i,   // Repeated single character like "aaaa"
    ];

    for (const pattern of noisePatterns) {
      if (pattern.test(text)) {
        return false;
      }
    }

    // Check if it has actual words
    const words = text.split(/\s+/).filter(w => w.length >= 1);

    // Very short words (1-2 chars) that are not in the list
    if (text.length < 2) return false;

    if (words.length < 2) {
      // Single word - only accept if it's a question word or important word
      // Single word - only accept if it's common conversational word
      const commonWords = [
        'what', 'who', 'where', 'when', 'why', 'how', 'which', 'whose',
        'yes', 'no', 'ok', 'okay', 'help', 'stop', 'start', 'wait', 'go',
        'hello', 'hi', 'hey', 'thanks', 'thank', 'cool', 'nice', 'good', 'bad'
      ];
      const lowerText = text.toLowerCase().trim().replace(/[?.!,]/g, '');
      if (!commonWords.includes(lowerText)) {
        return false;
      }
    }

    // Filter common transcription errors (e.g., "what is your name" misheard)
    const commonErrors = [
      /^[a-z]{1,3}\s+[a-z]{1,3}\s+[a-z]{1,3}$/i,  // Very short words only
      /^(the|a|an)\s+[a-z]{1,2}$/i,  // Article + very short word
    ];

    for (const pattern of commonErrors) {
      if (pattern.test(text) && words.length < 3) {
        return false;
      }
    }

    return words.length > 0;
  }

  /**
   * Calculate similarity between two strings (simple Levenshtein-based)
   */
  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    // Simple word-based similarity
    const words1 = str1.toLowerCase().split(/\s+/);
    const words2 = str2.toLowerCase().split(/\s+/);
    const commonWords = words1.filter(w => words2.includes(w));
    const totalWords = new Set([...words1, ...words2]).size;

    return commonWords.length / totalWords;
  }

  /**
   * Generate AI response (using chat history from ChatUI)
   */
  async generateResponse(userText) {
    console.log('generateResponse called with text:', userText);
    this.isProcessing = true;
    this.responseBuffer = ''; // Reset buffer for new response
    this.updateStatus();

    try {
      // Reload config to ensure we have the latest keys/settings
      await this.loadConfig();

      // Get messages from ChatUI instead of maintaining separate history
      let messages = [];
      if (this.chatUI && this.chatUI.messages) {
        // Filter out "Thinking..." placeholder and get actual messages
        messages = this.chatUI.messages
          .filter(msg => msg.content !== 'Thinking...')
          .map(msg => ({
            role: msg.role,
            content: msg.content
          }));
      }

      // Check if the user message was already added by onTranscription callback
      // If the last message is already the user message, don't add it again
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userText) {
        // User message not found in chat history, add it
        messages.push({
          role: 'user',
          content: userText
        });
      }

      // Get chat context if available
      let chatContext = null;
      if (this.chatUI && this.chatUI.context) {
        chatContext = this.chatUI.context;
      }

      // Get provider config - use the chat's selected provider, not voice assistant's internal provider
      const accounts = this.config?.accounts || [];
      let providerConfig = null;

      // Use the chat's selected provider (from dropdown) instead of voice assistant's internal provider
      const selectedProviderId = window.currentProviderId || null;
      console.log('[VoiceAssistant] Using chat selected provider:', selectedProviderId, 'instead of voice assistant provider:', this.currentProvider);

      if (selectedProviderId) {
        // Find the account by name (the selected provider ID is the account name)
        const selectedAccount = accounts.find(acc => acc.name === selectedProviderId);
        if (selectedAccount) {
          console.log('[VoiceAssistant] Found selected account:', {
            name: selectedAccount.name,
            type: selectedAccount.type,
            model: selectedAccount.model
          });

          // SAFEGUARD: Ensure we don't use Whisper model for Chat
          let model = selectedAccount.model || (selectedAccount.type === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-3.5-turbo');
          if (model.includes('whisper')) {
            console.warn('[VoiceAssistant] Whisper model selected for chat - falling back to default');
            model = selectedAccount.type === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-3.5-turbo';
          }

          providerConfig = {
            name: selectedAccount.name,
            type: selectedAccount.type,
            apiKey: selectedAccount.apiKey,
            model: model,
            baseURL: selectedAccount.baseURL
          };
        } else {
          console.warn('[VoiceAssistant] Selected provider not found in accounts, falling back to old logic');
          // Fallback to old logic if selected provider not found
          if (this.currentProvider === 'groq') {
            const groqAccount = accounts.find(a => a.type === 'groq');
            if (groqAccount) {
              let model = groqAccount.model || 'llama-3.1-8b-instant';
              if (model.includes('whisper')) {
                model = 'llama-3.1-8b-instant';
              }
              providerConfig = {
                name: groqAccount.name,
                type: 'groq',
                apiKey: groqAccount.apiKey,
                model: model,
                baseURL: groqAccount.baseURL
              };
            }
          } else {
            const openaiAccount = accounts.find(a => a.type === 'openai');
            if (openaiAccount) {
              providerConfig = {
                name: openaiAccount.name,
                type: 'openai',
                apiKey: openaiAccount.apiKey,
                model: openaiAccount.model || 'gpt-3.5-turbo',
                baseURL: openaiAccount.baseURL
              };
            }
          }
        }
      } else {
        // No provider selected in chat, use old logic as fallback
        console.warn('[VoiceAssistant] No chat provider selected, using voice assistant provider:', this.currentProvider);
        if (this.currentProvider === 'groq') {
          const groqAccount = accounts.find(a => a.type === 'groq');
          if (groqAccount) {
            let model = groqAccount.model || 'llama-3.1-8b-instant';
            if (model.includes('whisper')) {
              model = 'llama-3.1-8b-instant';
            }
            providerConfig = {
              name: groqAccount.name,
              type: 'groq',
              apiKey: groqAccount.apiKey,
              model: model,
              baseURL: groqAccount.baseURL
            };
          }
        } else {
          const openaiAccount = accounts.find(a => a.type === 'openai');
          if (openaiAccount) {
            providerConfig = {
              name: openaiAccount.name,
              type: 'openai',
              apiKey: openaiAccount.apiKey,
              model: openaiAccount.model || 'gpt-3.5-turbo',
              baseURL: openaiAccount.baseURL
            };
          }
        }
      }

      if (!providerConfig) {
        console.error('generateResponse: No AI provider configured');
        console.error('Current provider:', this.currentProvider);
        console.error('Available accounts:', accounts);
        this.showError('No AI provider configured');
        if (this.chatUI) this.chatUI.addMessage('assistant', '[Error: No AI provider configured. Please check Settings.]');
        return;
      }

      // Validate provider config has required fields
      if (!providerConfig.apiKey) {
        console.error('generateResponse: Provider config missing API key');
        this.showError('API key missing for provider');
        if (this.chatUI) this.chatUI.addMessage('assistant', '[Error: API key missing. Please check Settings.]');
        return;
      }

      console.log('Provider config validated:', {
        type: providerConfig.type,
        model: providerConfig.model,
        hasApiKey: !!providerConfig.apiKey
      });

      // Prepare system prompt with context
      let systemPrompt = this.mode === 'mine'
        ? 'You are a real-time voice AI assistant. Provide short, clear, conversational responses. Respond naturally as if in a conversation.'
        : 'You are a real-time voice AI assistant listening to system audio. Provide short, clear, helpful responses. If the audio contains questions or meaningful content, answer them conversationally.';

      // Prepend context if available
      if (chatContext) {
        systemPrompt = `Context: ${chatContext}. ${systemPrompt}`;
      }

      // Build messages array with system prompt first
      const messagesWithSystem = [
        { role: 'system', content: systemPrompt },
        ...messages
      ];

      // Also include context in user message for better awareness
      if (chatContext && messages.length > 0) {
        const lastUserMsg = messagesWithSystem[messagesWithSystem.length - 1];
        if (lastUserMsg.role === 'user') {
          lastUserMsg.content = `[Context: ${chatContext}] ${lastUserMsg.content}`;
        }
      }

      // Add a placeholder message immediately if not already present
      if (this.chatUI && typeof this.chatUI.addMessage === 'function') {
        // Check if last message is already assistant waiting
        const lastMsg = this.chatUI.messages[this.chatUI.messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'assistant') {
          this.chatUI.addMessage('assistant', 'Thinking...');
        }
      }

      // Stream response
      this.responseBuffer = '';

      // Use streaming API with immediate UI updates
      try {
        console.log('Starting AI stream with provider:', providerConfig.type, 'model:', providerConfig.model);
        console.log('Messages count:', messagesWithSystem.length);

        await window.electronAPI.sendAIMessageStream(
          providerConfig,
          messagesWithSystem,
          (chunk) => {
            this.responseBuffer += chunk;
            console.log('Received chunk, buffer length:', this.responseBuffer.length);

            // Update status overlay immediately
            this.updateStatus();

            // Update UI callback (tells ChatUI to update its message view)
            if (this.onResponse) {
              this.onResponse(this.responseBuffer, false);
            }
          }
        );

        // Final response handling
        console.log('Stream complete, final buffer length:', this.responseBuffer ? this.responseBuffer.length : 0);
        if (this.responseBuffer && this.responseBuffer.trim()) {
          if (this.onResponse) {
            this.onResponse(this.responseBuffer, true);
          }
        } else {
          console.warn('Stream completed but response buffer is empty or whitespace');
          if (this.chatUI) {
            this.chatUI.addMessage('assistant', '[Error: Received empty response from AI]');
          }
        }
      } catch (streamError) {
        console.error('Stream error caught:', streamError);
        throw streamError;
      }

    } catch (error) {
      console.error('Failed to generate response:', error);
      this.showError(`Response error: ${error.message}`);
      if (this.chatUI && typeof this.chatUI.addMessage === 'function') {
        this.chatUI.addMessage('assistant', `[Error: ${error.message}]`);
      }
    } finally {
      this.isProcessing = false;
      this.updateStatus();
    }
  }

  /**
   * Ensure window stays on top and is focused
   */
  async ensureWindowOnTop() {
    try {
      // Check current always-on-top state
      const alwaysOnTopResult = await window.electronAPI.getAlwaysOnTop();
      if (alwaysOnTopResult.success && !alwaysOnTopResult.alwaysOnTop) {
        // Re-enable always on top
        await window.electronAPI.toggleAlwaysOnTop();
      }

      // Bring window to front
      if (window.electronAPI.bringWindowToFront) {
        await window.electronAPI.bringWindowToFront();
      }
    } catch (error) {
      console.warn('Failed to ensure window on top:', error);
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    // Throttle error messages to prevent spam
    const now = Date.now();
    if (message === this.lastErrorMessage && now - this.lastErrorTime < 2000) {
      console.log('Suppressing duplicate error:', message);
      return;
    }

    this.lastErrorMessage = message;
    this.lastErrorTime = now;

    console.error('Voice Assistant Error:', message);

    if (this.onError) {
      this.onError(message);
    }

    // Update status with error
    if (this.statusIndicator) {
      this.statusIndicator.className = 'voice-assistant-status error';
      this.statusIndicator.innerHTML = `
        <div class="status-error">
          <i data-feather="alert-circle" class="icon icon-small"></i> ${message}
        </div>
      `;
      // Re-initialize icons
      if (typeof feather !== 'undefined') {
        feather.replace();
      }

      // Clear error after 5 seconds
      setTimeout(() => {
        if (this.statusIndicator && !this.isActive) {
          this.statusIndicator.className = 'voice-assistant-status';
          this.statusIndicator.innerHTML = '';
        }
      }, 5000);
    }
  }
}

// Export for use in renderer
// Make it available globally for script tag loading
// Always attach to window if it exists (should always exist in browser context)
if (typeof window !== 'undefined') {
  window.VoiceAssistant = VoiceAssistant;
  console.log('✅ VoiceAssistant class attached to window.VoiceAssistant');
} else {
  // Fallback: try to attach anyway (for edge cases)
  try {
    globalThis.VoiceAssistant = VoiceAssistant;
    globalThis.window = globalThis.window || globalThis;
    globalThis.window.VoiceAssistant = VoiceAssistant;
    console.log('✅ VoiceAssistant attached via globalThis fallback');
  } catch (e) {
    console.error('❌ Failed to attach VoiceAssistant:', e);
  }
}

// Also support CommonJS if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VoiceAssistant;
}

