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
  }

  /**
   * Initialize the voice assistant
   * @param {ChatUI} chatUI - Reference to ChatUI instance for message history
   */
  async initialize(chatUI = null) {
    this.chatUI = chatUI;
    await this.loadConfig();
    this.setupUI();
  }

  /**
   * Load configuration
   */
  async loadConfig() {
    try {
      const result = await window.electronAPI.getConfig();
      if (result.success && result.data) {
        this.config = result.data;

        // Get voice API setting from settings (user's preference)
        const settings = this.config.settings || {};
        const voiceAPI = settings.voiceAPI || 'groq-whisper'; // Default to Groq Whisper
        
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
        modeToggle = document.createElement('div');
        modeToggle.id = 'voice-mode-toggle';
        modeToggle.className = 'voice-mode-toggle';
        modeToggle.innerHTML = `
          <span class="toggle-option active" data-mode="mine">
            <i data-feather="mic" class="icon"></i> MINE
          </span>
          <span class="toggle-option" data-mode="yours">
            <i data-feather="volume-2" class="icon"></i> YOURS
          </span>
        `;
        // Initialize icons after adding to DOM
        if (typeof feather !== 'undefined') {
          feather.replace();
        }
        modeToggle.title = 'Toggle between MINE MODE (Microphone) and YOURS MODE (System Audio)';

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
          console.log('Voice mode toggle switch created and added to input area');
        } else {
          console.error('Could not find input area to insert mode toggle switch');
        }
      } else {
        console.log('Voice mode toggle switch found in DOM');
      }

      this.modeButton = modeToggle;

      // Use event delegation on the toggle container to handle all clicks
      const modeToggleHandler = async (e) => {
        console.log('=== TOGGLE CLICK DETECTED ===');
        console.log('Target:', e.target);
        console.log('Target tagName:', e.target.tagName);
        console.log('Target classList:', e.target.classList?.toString());
        console.log('CurrentTarget:', e.currentTarget);
        console.log('ModeButton:', this.modeButton);

        e.preventDefault();
        e.stopPropagation();

        // Find the clicked toggle option - use closest which works even with pointer-events: none
        const clickedOption = e.target.closest('.toggle-option');

        console.log('Clicked option:', clickedOption);

        if (clickedOption) {
          // Click was on a toggle option (or its child)
          const targetMode = clickedOption.getAttribute('data-mode');
          console.log('Toggle option clicked, target mode:', targetMode, 'current mode:', this.mode);

          if (targetMode && targetMode !== this.mode) {
            // Switch to the clicked mode
            console.log('Switching mode from', this.mode, 'to:', targetMode);
            try {
              await this.setMode(targetMode);
            } catch (error) {
              console.error('Error in setMode:', error);
            }
          } else if (targetMode === this.mode) {
            console.log('Same mode clicked, no change needed');
          }
        } else {
          // Click was on the container itself (not on an option) - toggle between modes
          console.log('Mode toggle container clicked, current mode:', this.mode);
          try {
            await this.toggleMode();
          } catch (error) {
            console.error('Error in toggleMode:', error);
          }
        }
      };

      // Remove any existing listener first
      if (this._modeToggleHandler) {
        this.modeButton.removeEventListener('click', this._modeToggleHandler, true);
      }

      // Add the new listener with capture phase to ensure it fires
      this.modeButton.addEventListener('click', modeToggleHandler, true);

      // Store handler for potential cleanup
      this._modeToggleHandler = modeToggleHandler;

      console.log('Toggle switch event handler attached to:', this.modeButton);
      console.log('Toggle element:', this.modeButton);
      console.log('Toggle options:', this.modeButton.querySelectorAll('.toggle-option'));

      // ALSO add direct handlers to each toggle option as a backup
      // This ensures clicks work even if event delegation has issues
      const toggleOptions = this.modeButton.querySelectorAll('.toggle-option');
      toggleOptions.forEach(option => {
        // Remove any existing handlers by cloning
        const newOption = option.cloneNode(true);
        if (option.parentNode) {
          option.parentNode.replaceChild(newOption, option);
        }

        // Add click handler
        newOption.addEventListener('click', async (e) => {
          console.log('DIRECT OPTION HANDLER FIRED!', newOption.getAttribute('data-mode'));
          e.preventDefault();
          e.stopPropagation();

          const targetMode = newOption.getAttribute('data-mode');
          if (targetMode && targetMode !== this.mode) {
            console.log('Direct handler: Switching mode from', this.mode, 'to:', targetMode);
            try {
              await this.setMode(targetMode);
            } catch (error) {
              console.error('Error in setMode:', error);
            }
          }
        });

        // Make sure it's clickable
        newOption.style.cursor = 'default';
        newOption.style.pointerEvents = 'auto';
      });

      // Initial UI update to set correct state
      this.updateUI();

      // Update listen button - use the existing button, don't clone
      // Make sure we run this AFTER the old system setup to override it
      const listenBtn = document.getElementById('listen-button');
      if (listenBtn) {
        this.startButton = listenBtn;
        // Remove any existing listeners by cloning (to clear old listeners)
        const newListenBtn = this.startButton.cloneNode(true);
        if (this.startButton.parentNode) {
          this.startButton.parentNode.replaceChild(newListenBtn, this.startButton);
        }
        this.startButton = newListenBtn;

        // Add our handler with higher priority (capture phase)
        this.startButton.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation(); // Prevent other handlers
          console.log('VoiceAssistant: Start/Stop button clicked, current state:', this.isActive, 'mode:', this.mode);
          await this.toggle();
        }, true); // Use capture phase to run before other handlers

        // Make VoiceAssistant globally available so old system can check
        window.voiceAssistant = this;
      } else {
        console.warn('Listen button not found');
      }

      this.updateUI();
      console.log('Voice Assistant UI setup complete. Mode button:', this.modeButton);
    }, 200); // Delay to ensure DOM is ready and other systems are initialized
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
    console.log('updateUI called, mode:', this.mode, 'isActive:', this.isActive);

    // Update toggle switch to show current mode
    if (this.modeButton) {
      const toggleOptions = this.modeButton.querySelectorAll('.toggle-option');

      if (this.mode === 'mine') {
        this.modeButton.classList.remove('yours-mode');
        this.modeButton.title = 'Currently: MINE MODE (Microphone). Click to switch to YOURS MODE (System Audio)';
        toggleOptions.forEach(option => {
          if (option.getAttribute('data-mode') === 'mine') {
            option.classList.add('active');
          } else {
            option.classList.remove('active');
          }
        });
        console.log('Updated toggle switch to MINE mode');
      } else {
        this.modeButton.classList.add('yours-mode');
        this.modeButton.title = 'Currently: YOURS MODE (System Audio). Click to switch to MINE MODE (Microphone)';
        toggleOptions.forEach(option => {
          if (option.getAttribute('data-mode') === 'yours') {
            option.classList.add('active');
          } else {
            option.classList.remove('active');
          }
        });
        console.log('Updated toggle switch to YOURS mode');
      }

      // Ensure toggle is visible
      this.modeButton.style.display = 'inline-flex';
      this.modeButton.style.visibility = 'visible';
      this.modeButton.style.opacity = '1';

      // Force a reflow to ensure the change is visible
      this.modeButton.offsetHeight;

      // Re-initialize icons after DOM update
      setTimeout(() => {
        if (typeof feather !== 'undefined') {
          feather.replace();
        }
      }, 0);
    } else {
      console.warn('modeButton is null in updateUI');
    }

    // Update start/stop button
    if (this.startButton) {
      if (this.isActive) {
        // When active, show Stop button
        this.startButton.innerHTML = '<i data-feather="square" class="icon icon-small"></i> Stop';
        this.startButton.title = `Stop voice assistant (currently in ${this.mode === 'mine' ? 'MINE' : 'YOURS'} mode)`;
        this.startButton.classList.add('listening');
      } else {
        // When stopped, show Start button with mode icon
        if (this.mode === 'mine') {
          this.startButton.innerHTML = '<i data-feather="mic" class="icon icon-small"></i> Start';
          this.startButton.title = 'Start voice assistant in MINE MODE (Microphone)';
        } else {
          this.startButton.innerHTML = '<i data-feather="volume-2" class="icon icon-small"></i> Start';
          this.startButton.title = 'Start voice assistant in YOURS MODE (System Audio)';
        }
        this.startButton.classList.remove('listening');
      }
      // Re-initialize icons
      if (typeof feather !== 'undefined') {
        feather.replace();
      }
    }

    this.updateStatus();
  }

  /**
   * Update status indicator
   */
  updateStatus() {
    if (!this.statusIndicator) return;

    if (this.isActive) {
      const iconName = this.mode === 'mine' ? 'mic' : 'volume-2';
      this.statusIndicator.className = 'voice-assistant-status active';
      this.statusIndicator.innerHTML = `
        <div class="status-mode">
          <i data-feather="${iconName}" class="icon icon-small"></i> ${this.mode === 'mine' ? 'MINE MODE' : 'YOURS MODE'}
        </div>
        <div class="status-text">${this.isProcessing ? 'Processing...' : 'Listening...'}</div>
        ${this.lastTranscription ? `<div class="status-transcript">${this.lastTranscription}</div>` : ''}
      `;
      // Re-initialize icons
      if (typeof feather !== 'undefined') {
        feather.replace();
      }
    } else {
      this.statusIndicator.className = 'voice-assistant-status';
      this.statusIndicator.innerHTML = '';
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
      console.log(`Starting voice assistant in ${this.mode} mode`);
      this.isActive = true;
      this.lastProcessedChunkIndex = 0; // Reset chunk tracking
      this.audioChunks = []; // Clear any old chunks
      this.updateUI();

      if (this.mode === 'mine') {
        await this.startMineMode();
      } else {
        await this.startYoursMode();
      }
    } catch (error) {
      console.error('Failed to start voice assistant:', error);
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

    // Stop audio stream
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }

    this.mediaRecorder = null;
    this.audioChunks = [];
    this.lastProcessedChunkIndex = 0;
    this.updateUI();
  }

  /**
   * Start MINE mode (microphone input ONLY - no system audio)
   */
  async startMineMode() {
    try {
      // Ensure window stays on top and focused before requesting permissions
      await this.ensureWindowOnTop();

      // Request microphone access ONLY - explicitly exclude system audio
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false
      });

      // Verify we got microphone tracks only
      const audioTracks = this.audioStream.getAudioTracks();
      console.log('MINE mode: Audio tracks:', audioTracks.length);
      audioTracks.forEach(track => {
        if (track.label.toLowerCase().includes('desktop') ||
          track.label.toLowerCase().includes('screen') ||
          track.label.toLowerCase().includes('system')) {
          console.warn('MINE mode: Warning - detected system audio track, stopping it');
          track.stop();
        }
      });

      // Bring window back to front
      await this.ensureWindowOnTop();

      // Initialize chunk storage for the cycle
      this.currentCycleChunks = [];

      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.audioStream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      // Handle data available
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.currentCycleChunks.push(event.data);
        }
      };

      // Handle stop - process the cycle's audio
      this.mediaRecorder.onstop = async () => {
        if (this.currentCycleChunks.length > 0) {
          const blob = new Blob(this.currentCycleChunks, { type: 'audio/webm' });
          this.currentCycleChunks = []; // Reset for next cycle (though we create new recorder usually)
          await this.processAudioBlob(blob);
        }

        // Restart if still active
        if (this.isActive) {
          this.startRecordingCycle();
        }
      };

      // Start the first cycle
      this.startRecordingCycle();

    } catch (error) {
      console.error('Failed to start MINE mode:', error);
      throw new Error(`Microphone access denied: ${error.message}`);
    }
  }

  // Helper to manage the recording cycle
  startRecordingCycle() {
    if (!this.isActive || !this.mediaRecorder || this.mediaRecorder.state !== 'inactive') return;

    this.currentCycleChunks = [];
    this.mediaRecorder.start();

    // Record for 2 seconds then stop -> creates a valid file
    setTimeout(() => {
      if (this.isActive && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      }
    }, 2000);
  }

  /**
   * Start YOURS mode (system/speaker audio ONLY - no microphone)
   */
  async startYoursMode() {
    try {
      // Ensure window stays on top and focused
      await this.ensureWindowOnTop();

      // Request desktop/system audio capture ONLY
      let stream = null;

      try {
        // Try getDisplayMedia first
        // video: true is REQUIRED for getDisplayMedia to work at all
        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            suppressLocalAudioPlayback: false,
            sampleRate: 44100
          },
          video: true
        });

        // We only care about audio, stop video trace immediately to save resources
        stream.getVideoTracks().forEach(track => track.stop());

        console.log('YOURS: getDisplayMedia success');
      } catch (displayMediaError) {
        console.warn('getDisplayMedia failed, trying desktopCapturer:', displayMediaError);

        // Fallback or retry with different constraints
        const sources = await window.electronAPI.getDesktopSources({ types: ['screen'] });
        if (!sources.success || sources.sources.length === 0) throw new Error('No system audio sources found during fallback.');

        const sourceId = sources.sources[0].id;

        // Electron-specific constraint syntax
        // Note: chromeMediaSource MUST be in 'video' mandatory constraints even for audio-only scenarios in some electron versions,
        // but typically we ask for both and strip video.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId // In some cases, audio doesn't need ID if extracting from system?
              // Actually, for system audio loopback in Electron:
              // audio: { mandatory: { chromeMediaSource: 'desktop' } } might be enough without ID for 'entire system'
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          }
        });

        // Stop video tracks
        stream.getVideoTracks().forEach(track => track.stop());
        console.log('YOURS: desktopCapturer fallback success');
      }

      // Filter tracks - verify we have audio
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio tracks captured. Ensure you shared "System Audio".');
      }

      // Filter out microphone tracks if any accidentally got mixed in (rare in this flow)
      // (Simplified: just use the first audio track, assuming system audio)
      this.audioStream = new MediaStream([audioTracks[0]]);




      // Initialize chunk storage
      this.currentCycleChunks = [];

      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.audioStream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      // Handle data available
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.currentCycleChunks.push(event.data);
        }
      };

      // Handle stop
      this.mediaRecorder.onstop = async () => {
        if (this.currentCycleChunks.length > 0) {
          const blob = new Blob(this.currentCycleChunks, { type: 'audio/webm' });
          this.currentCycleChunks = [];
          await this.processAudioBlob(blob);
        }

        if (this.isActive) {
          this.startRecordingCycle();
        }
      };

      // Start first cycle
      this.startRecordingCycle();

    } catch (error) {
      console.error('Failed to start YOURS mode:', error);
      throw error;
    }
  }

  /**
   * Process audio chunk for transcription
   */
  async processAudioBlob(audioBlob) {
    if (this.isProcessing) return;

    // Verify blob size (min 5KB)
    if (audioBlob.size < 5000) {
      return;
    }

    this.isProcessing = true;
    this.updateStatus();

    try {
      // Reload config to ensure we have the latest voice API setting
      await this.loadConfig();
      
      // Convert to ArrayBuffer for IPC
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      console.log(`Processing audio blob: ${audioBlob.size} bytes`);
      console.log(`[VoiceAssistant] Using whisper provider: ${this.whisperProvider}, model: ${this.whisperModel}`);

      // Transcribe using Whisper API
      const transcriptionResult = await window.electronAPI.transcribeAudio(
        Array.from(uint8Array),
        this.whisperApiKey,
        this.whisperProvider,
        this.whisperModel
      );

      if (transcriptionResult.success && transcriptionResult.text) {
        const text = transcriptionResult.text.trim();

        // Anti-hallucination / filter logic
        if (this.isMeaningfulSpeech(text)) {
          // Skip duplicates logic
          const isDuplicate = this.recentTranscriptions.some(prev => {
            const similarity = this.calculateSimilarity(text, prev);
            return similarity > 0.8;
          });

          if (!isDuplicate) {
            this.lastTranscription = text;
            this.lastTranscriptionTime = Date.now();
            this.recentTranscriptions.push(text);
            if (this.recentTranscriptions.length > 5) this.recentTranscriptions.shift();

            this.updateStatus();

            if (this.onTranscription) {
              this.onTranscription(text);
            }

            console.log(`Voice mode (${this.mode}): Auto-filling input and clicking send`);

            // Find input and send button
            const input = this.chatUI?.inputArea || document.getElementById('message-input');
            const sendBtn = this.chatUI?.sendButton || document.getElementById('send-button');

            if (input && sendBtn) {
              // Set input value
              input.value = text;
              // Trigger input event to ensure any binding/resizing happens
              input.dispatchEvent(new Event('input', { bubbles: true }));

              // Click send button to use the standard chat logic
              // This ensures we get the "100% working" chat behavior user wants
              setTimeout(() => {
                sendBtn.click();
              }, 100);
            } else {
              console.warn('VoiceAssistant: Could not find input or send button, falling back to internal response generation');
              await this.generateResponse(text);
            }
          }
        } else {
          this.lastTranscription = '...';
          this.updateStatus();
        }
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

  /**
   * Check if text is meaningful speech (enhanced filtering)
   */
  isMeaningfulSpeech(text) {
    if (!text || text.length < 3) return false;

    // Filter out common transcription artifacts
    const noisePatterns = [
      /^[\s\.,!?\-]+$/,  // Only punctuation/whitespace
      /^(uh|um|ah|er|hmm|mm|huh)+$/i,  // Only filler words
      /^[^\w\s]+$/,  // Only special characters
      /^[a-z]{1,2}$/i,  // Single or double letter (likely noise)
    ];

    for (const pattern of noisePatterns) {
      if (pattern.test(text)) {
        return false;
      }
    }

    // Check if it has actual words (minimum 2-3 words for meaningful speech)
    const words = text.split(/\s+/).filter(w => w.length > 1);
    if (words.length < 2) {
      // Single word - only accept if it's a question word or important word
      const questionWords = ['what', 'who', 'where', 'when', 'why', 'how', 'which', 'whose'];
      const importantWords = ['yes', 'no', 'ok', 'okay', 'help', 'stop', 'start'];
      const lowerText = text.toLowerCase().trim();
      if (!questionWords.includes(lowerText) && !importantWords.includes(lowerText)) {
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

            // Update UI immediately on each chunk for low latency
            if (this.onResponse) {
              this.onResponse(this.responseBuffer, false);
            }
          }
        );

        // Final response
        console.log('Stream complete, final buffer length:', this.responseBuffer.length);
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

