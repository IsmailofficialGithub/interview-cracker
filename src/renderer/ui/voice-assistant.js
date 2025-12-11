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
        
        // Find Groq provider first, then OpenAI
        const accounts = this.config.accounts || [];
        const groqAccount = accounts.find(a => a.type === 'groq');
        const openaiAccount = accounts.find(a => a.type === 'openai');
        
        if (groqAccount) {
          this.currentProvider = 'groq';
          this.whisperProvider = 'groq';
          this.whisperApiKey = groqAccount.apiKey;
          this.whisperModel = 'whisper-large-v3-turbo';
        } else if (openaiAccount) {
          this.currentProvider = 'openai';
          this.whisperProvider = 'openai';
          this.whisperApiKey = openaiAccount.apiKey;
          this.whisperModel = 'whisper-1';
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
        newOption.style.cursor = 'pointer';
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
    console.log('Toggle called, isActive:', this.isActive, 'mode:', this.mode);
    if (this.isActive) {
      console.log('Stopping voice assistant...');
      await this.stop();
    } else {
      console.log('Starting voice assistant...');
      await this.start();
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
          // Explicitly request microphone, not system audio
          // This ensures we only get microphone input
        },
        // Explicitly NO video or desktop capture
        video: false
      });
      
      // Verify we got microphone tracks only (not system audio)
      const audioTracks = this.audioStream.getAudioTracks();
      console.log('MINE mode: Audio tracks:', audioTracks.length);
      audioTracks.forEach(track => {
        console.log('MINE mode: Track label:', track.label, 'kind:', track.kind);
        // Ensure it's a microphone track, not desktop audio
        if (track.label.toLowerCase().includes('desktop') || 
            track.label.toLowerCase().includes('screen') ||
            track.label.toLowerCase().includes('system')) {
          console.warn('MINE mode: Warning - detected system audio track, stopping it');
          track.stop();
        }
      });
      
      // Bring window back to front after permission request
      await this.ensureWindowOnTop();
      
      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.audioStream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      this.audioChunks = [];
      
      // Start continuous recording with chunks
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
      
      // Start recording in chunks (every 1.5 seconds for lower latency)
      this.mediaRecorder.start(1500);
      
      // Process audio chunks every 1.5 seconds for faster response
      this.transcriptionInterval = setInterval(async () => {
        // Only process if we have new chunks since last processing
        if (this.audioChunks.length > this.lastProcessedChunkIndex && !this.isProcessing) {
          await this.processAudioChunk();
        }
      }, 1500);
      
    } catch (error) {
      console.error('Failed to start MINE mode:', error);
      throw new Error(`Microphone access denied: ${error.message}`);
    }
  }
  
  /**
   * Start YOURS mode (system/speaker audio ONLY - no microphone)
   */
  async startYoursMode() {
    try {
      // Ensure window stays on top and focused
      await this.ensureWindowOnTop();
      
      // Request desktop/system audio capture ONLY
      // First try getDisplayMedia for system audio
      let stream = null;
      
      try {
        // Try getDisplayMedia first (modern approach for system audio)
        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            // Request system audio, not microphone
            suppressLocalAudioPlayback: false
          },
          video: false // We only want audio
        });
        
        // Verify we got system audio tracks, not microphone
        const audioTracks = stream.getAudioTracks();
        console.log('YOURS mode: Audio tracks:', audioTracks.length);
        
        let hasSystemAudio = false;
        audioTracks.forEach(track => {
          console.log('YOURS mode: Track label:', track.label, 'kind:', track.kind);
          // Check if it's system/desktop audio
          const label = track.label.toLowerCase();
          if (label.includes('desktop') || 
              label.includes('screen') ||
              label.includes('system') ||
              label.includes('speaker') ||
              label.includes('output')) {
            hasSystemAudio = true;
            console.log('YOURS mode: Found system audio track');
          } else if (label.includes('microphone') || 
                     label.includes('mic') ||
                     label.includes('input')) {
            // This is a microphone track, we don't want it in YOURS mode
            console.warn('YOURS mode: Detected microphone track, stopping it');
            track.stop();
          }
        });
        
        if (!hasSystemAudio && audioTracks.length > 0) {
          console.warn('YOURS mode: No clear system audio detected, but tracks exist');
        }
        
        this.audioStream = stream;
      } catch (displayMediaError) {
        console.warn('getDisplayMedia failed, trying desktopCapturer:', displayMediaError);
        
        // Fallback: Try desktopCapturer API
        const sources = await window.electronAPI.getDesktopSources({ types: ['screen'] });
        
        if (!sources.success || sources.sources.length === 0) {
          throw new Error('No system audio sources available. YOURS mode requires system audio capture.');
        }
        
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sources.sources[0].id
              },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            },
            video: false
          });
          
          // Verify it's system audio, not microphone
          const audioTracks = stream.getAudioTracks();
          audioTracks.forEach(track => {
            const label = track.label.toLowerCase();
            if (label.includes('microphone') || label.includes('mic') || label.includes('input')) {
              console.warn('YOURS mode: Detected microphone in desktop capture, stopping it');
              track.stop();
            }
          });
          
          this.audioStream = stream;
        } catch (desktopError) {
          // If both methods fail, show error
          this.showError('System audio capture not available. YOURS mode requires system/speaker audio, not microphone. Please set up virtual audio capture or use MINE mode for microphone.');
          throw new Error('YOURS mode requires system audio capture. Use MINE mode for microphone input.');
        }
      }
      
      // Final verification: ensure no microphone tracks
      const finalTracks = this.audioStream.getAudioTracks();
      finalTracks.forEach(track => {
        const label = track.label.toLowerCase();
        if (label.includes('microphone') || label.includes('mic') || label.includes('input')) {
          console.error('YOURS mode: ERROR - microphone track still present, removing');
          track.stop();
        }
      });
      
      if (this.audioStream.getAudioTracks().length === 0) {
        throw new Error('No system audio tracks available. YOURS mode requires system/speaker audio.');
      }
      
      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.audioStream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      this.audioChunks = [];
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
      
      // Start recording in chunks (every 1.5 seconds for lower latency)
      this.mediaRecorder.start(1500);
      
      // Process audio chunks every 1.5 seconds for faster response
      this.transcriptionInterval = setInterval(async () => {
        // Only process if we have new chunks since last processing
        if (this.audioChunks.length > this.lastProcessedChunkIndex && !this.isProcessing) {
          await this.processAudioChunk();
        }
      }, 1500);
      
    } catch (error) {
      console.error('Failed to start YOURS mode:', error);
      throw error;
    }
  }
  
  /**
   * Process audio chunk for transcription
   */
  async processAudioChunk() {
    // Get only new chunks since last processing
    const newChunks = this.audioChunks.slice(this.lastProcessedChunkIndex);
    
    if (this.isProcessing || newChunks.length === 0) return;
    
    // Check minimum size (at least 5KB to ensure valid audio - reduced for lower latency)
    const totalSize = newChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    if (totalSize < 5000) {
      // Too small, wait for more data
      return;
    }
    
    this.isProcessing = true;
    this.updateStatus();
    
    try {
      // Combine only the new audio chunks
      const audioBlob = new Blob(newChunks, { type: 'audio/webm' });
      
      // Verify blob is valid (reduced threshold for lower latency)
      if (audioBlob.size < 5000) {
        console.warn('Audio blob too small, skipping:', audioBlob.size);
        this.isProcessing = false;
        return;
      }
      
      // Convert to ArrayBuffer for IPC
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      console.log(`Processing audio chunk: ${audioBlob.size} bytes, ${newChunks.length} chunks`);
      
      // Transcribe using Whisper API
      const transcriptionResult = await window.electronAPI.transcribeAudio(
        Array.from(uint8Array),
        this.whisperApiKey,
        this.whisperProvider,
        this.whisperModel
      );
      
      if (transcriptionResult.success && transcriptionResult.text) {
        const text = transcriptionResult.text.trim();
        
        // Debounce: Check if we recently processed similar transcription
        const now = Date.now();
        if (now - this.lastTranscriptionTime < 500) {
          // Too soon after last transcription, skip to avoid duplicates
          this.isProcessing = false;
          this.updateStatus();
          return;
        }
        
        // Check if it's meaningful speech with enhanced filtering
        if (this.isMeaningfulSpeech(text)) {
          // Check for duplicate transcriptions
          const isDuplicate = this.recentTranscriptions.some(prev => {
            const similarity = this.calculateSimilarity(text, prev);
            return similarity > 0.8; // 80% similar = likely duplicate
          });
          
          if (!isDuplicate) {
            this.lastTranscription = text;
            this.lastTranscriptionTime = now;
            this.recentTranscriptions.push(text);
            // Keep only last 5 transcriptions for duplicate checking
            if (this.recentTranscriptions.length > 5) {
              this.recentTranscriptions.shift();
            }
            this.updateStatus();
            
            if (this.onTranscription) {
              this.onTranscription(text);
            }
            
            // Generate AI response immediately
            await this.generateResponse(text);
          } else {
            console.log('Skipping duplicate transcription:', text);
          }
        } else {
          // Noise or non-speech
          this.lastTranscription = 'I heard unclear or non-speech audio.';
          this.updateStatus();
        }
      } else if (!transcriptionResult.success) {
        console.warn('Transcription failed:', transcriptionResult.error);
        // Don't show error for every failed chunk, just log it
      }
      
      // Mark chunks as processed
      this.lastProcessedChunkIndex = this.audioChunks.length;
      
      // Clean up old chunks (keep last 2 for continuity, but don't process them again)
      if (this.audioChunks.length > 5) {
        const keepCount = Math.min(2, this.audioChunks.length);
        this.audioChunks = this.audioChunks.slice(-keepCount);
        this.lastProcessedChunkIndex = Math.max(0, this.audioChunks.length - keepCount);
      }
      
    } catch (error) {
      console.error('Failed to process audio chunk:', error);
      // Only show error if it's not a common "invalid file" error
      if (!error.message.includes('could not process file') && !error.message.includes('invalid media file')) {
        this.showError(`Transcription error: ${error.message}`);
      }
    } finally {
      this.isProcessing = false;
      this.updateStatus();
    }
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
    try {
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
      
      // Add current user message
      messages.push({
        role: 'user',
        content: userText
      });
      
      // Get chat context if available
      let chatContext = null;
      if (this.chatUI && this.chatUI.context) {
        chatContext = this.chatUI.context;
      }
      
      // Get provider config
      const accounts = this.config?.accounts || [];
      let providerConfig = null;
      
      if (this.currentProvider === 'groq') {
        const groqAccount = accounts.find(a => a.type === 'groq');
        if (groqAccount) {
          providerConfig = {
            type: 'groq',
            apiKey: groqAccount.apiKey,
            model: groqAccount.model || 'llama-3.1-8b-instant',
            baseURL: groqAccount.baseURL
          };
        }
      } else {
        const openaiAccount = accounts.find(a => a.type === 'openai');
        if (openaiAccount) {
          providerConfig = {
            type: 'openai',
            apiKey: openaiAccount.apiKey,
            model: openaiAccount.model || 'gpt-3.5-turbo',
            baseURL: openaiAccount.baseURL
          };
        }
      }
      
      if (!providerConfig) {
        this.showError('No AI provider configured');
        return;
      }
      
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
      
      // Stream response
      this.responseBuffer = '';
      
      // Use streaming API with immediate UI updates
      try {
        await window.electronAPI.sendAIMessageStream(
          providerConfig,
          messagesWithSystem,
          (chunk) => {
            // Handle error chunks
            if (typeof chunk === 'string' && chunk.startsWith('[ERROR]')) {
              throw new Error(chunk.substring(7));
            }
            
            this.responseBuffer += chunk;
            // Update UI immediately on each chunk for low latency
            if (this.onResponse) {
              this.onResponse(this.responseBuffer, false);
            }
          }
        );
        
        // Final response
        if (this.responseBuffer) {
          if (this.onResponse) {
            this.onResponse(this.responseBuffer, true);
          }
        }
      } catch (streamError) {
        throw streamError;
      }
      
    } catch (error) {
      console.error('Failed to generate response:', error);
      this.showError(`Response error: ${error.message}`);
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

