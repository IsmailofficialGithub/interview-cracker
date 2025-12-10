/**
 * Real-Time Voice Assistant
 * Supports two modes:
 * 1. SELF MODE: Microphone input, user speaking directly
 * 2. LISTEN MODE: System audio/environment audio capture
 */

class VoiceAssistant {
  constructor() {
    this.mode = 'self'; // 'self' or 'listen'
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
    this.conversationHistory = [];
    this.responseBuffer = '';
    this.lastProcessedChunkIndex = 0; // Track which chunks have been processed
    
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
      
      // Find or create mode toggle button (should already exist in HTML)
      let modeBtn = document.getElementById('voice-mode-toggle');
      if (!modeBtn) {
        // Create if it doesn't exist
        modeBtn = document.createElement('button');
        modeBtn.id = 'voice-mode-toggle';
        modeBtn.className = 'voice-mode-toggle';
        modeBtn.textContent = '🎤 SELF';
        modeBtn.title = 'Click to switch to LISTEN mode';
        
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
          inputArea.insertBefore(modeBtn, inputArea.firstChild);
          console.log('Voice mode toggle button created and added to input area');
        } else {
          console.error('Could not find input area to insert mode toggle button');
        }
      } else {
        console.log('Voice mode toggle button found in DOM');
      }
      
      this.modeButton = modeBtn;
      
      // Remove existing listeners by removing and re-adding the event listener
      // Use a named function so we can remove it if needed
      const modeToggleHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Mode toggle clicked, current mode:', this.mode);
        try {
          await this.toggleMode();
        } catch (error) {
          console.error('Error in toggleMode:', error);
        }
      };
      
      // Remove any existing listener first
      this.modeButton.removeEventListener('click', modeToggleHandler);
      // Add the new listener
      this.modeButton.addEventListener('click', modeToggleHandler);
      
      // Store handler for potential cleanup
      this._modeToggleHandler = modeToggleHandler;
      
      // Update listen button - use the existing button, don't clone
      const listenBtn = document.getElementById('listen-button');
      if (listenBtn) {
        this.startButton = listenBtn;
        // Remove any existing listeners by cloning (to clear old listeners)
        const newListenBtn = this.startButton.cloneNode(true);
        if (this.startButton.parentNode) {
          this.startButton.parentNode.replaceChild(newListenBtn, this.startButton);
        }
        this.startButton = newListenBtn;
        this.startButton.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('Start/Stop button clicked, current state:', this.isActive);
          await this.toggle();
        });
      } else {
        console.warn('Listen button not found');
      }
      
      this.updateUI();
      console.log('Voice Assistant UI setup complete. Mode button:', this.modeButton);
    }, 100); // Small delay to ensure DOM is ready
  }
  
  /**
   * Toggle between SELF and LISTEN modes
   */
  async toggleMode() {
    console.log('toggleMode called, current mode:', this.mode, 'isActive:', this.isActive);
    
    if (this.isActive) {
      console.log('Stopping voice assistant before mode switch');
      await this.stop();
    }
    
    // Toggle mode
    this.mode = this.mode === 'self' ? 'listen' : 'self';
    console.log('Mode switched to:', this.mode);
    
    // Update UI
    this.updateUI();
    console.log('UI updated, button text:', this.modeButton?.textContent);
  }
  
  /**
   * Update UI based on current state
   */
  updateUI() {
    console.log('updateUI called, mode:', this.mode, 'isActive:', this.isActive);
    
    // Update toggle button to show current mode
    if (this.modeButton) {
      if (this.mode === 'self') {
        this.modeButton.textContent = '🎤 SELF MODE';
        this.modeButton.title = 'Currently: SELF MODE (Microphone). Click to switch to LISTEN MODE (System Audio)';
        this.modeButton.classList.remove('listen-mode');
        console.log('Updated toggle button to SELF mode');
      } else {
        this.modeButton.textContent = '🔊 LISTEN MODE';
        this.modeButton.title = 'Currently: LISTEN MODE (System Audio). Click to switch to SELF MODE (Microphone)';
        this.modeButton.classList.add('listen-mode');
        console.log('Updated toggle button to LISTEN mode');
      }
      
      // Ensure button is visible
      this.modeButton.style.display = 'inline-block';
      this.modeButton.style.visibility = 'visible';
      this.modeButton.style.opacity = '1';
      
      // Force a reflow to ensure the change is visible
      this.modeButton.offsetHeight;
    } else {
      console.warn('modeButton is null in updateUI');
    }
    
    // Update start/stop button
    if (this.startButton) {
      if (this.isActive) {
        // When active, show Stop button
        this.startButton.textContent = '⏹ Stop';
        this.startButton.title = `Stop voice assistant (currently in ${this.mode === 'self' ? 'SELF' : 'LISTEN'} mode)`;
        this.startButton.classList.add('listening');
      } else {
        // When stopped, show Start button with mode icon
        if (this.mode === 'self') {
          this.startButton.textContent = '🎤 Start';
          this.startButton.title = 'Start voice assistant in SELF MODE (Microphone)';
        } else {
          this.startButton.textContent = '🔊 Start';
          this.startButton.title = 'Start voice assistant in LISTEN MODE (System Audio)';
        }
        this.startButton.classList.remove('listening');
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
      this.statusIndicator.className = 'voice-assistant-status active';
      this.statusIndicator.innerHTML = `
        <div class="status-mode">${this.mode === 'self' ? '🎤 SELF MODE' : '🔊 LISTEN MODE'}</div>
        <div class="status-text">${this.isProcessing ? 'Processing...' : 'Listening...'}</div>
        ${this.lastTranscription ? `<div class="status-transcript">${this.lastTranscription}</div>` : ''}
      `;
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
      
      if (this.mode === 'self') {
        await this.startSelfMode();
      } else {
        await this.startListenMode();
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
   * Start SELF mode (microphone input ONLY - no system audio)
   */
  async startSelfMode() {
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
      console.log('SELF mode: Audio tracks:', audioTracks.length);
      audioTracks.forEach(track => {
        console.log('SELF mode: Track label:', track.label, 'kind:', track.kind);
        // Ensure it's a microphone track, not desktop audio
        if (track.label.toLowerCase().includes('desktop') || 
            track.label.toLowerCase().includes('screen') ||
            track.label.toLowerCase().includes('system')) {
          console.warn('SELF mode: Warning - detected system audio track, stopping it');
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
      
      // Start recording in chunks (every 3 seconds)
      this.mediaRecorder.start(3000);
      
      // Process audio chunks every 3 seconds
      this.transcriptionInterval = setInterval(async () => {
        // Only process if we have new chunks since last processing
        if (this.audioChunks.length > this.lastProcessedChunkIndex && !this.isProcessing) {
          await this.processAudioChunk();
        }
      }, 3000);
      
    } catch (error) {
      console.error('Failed to start SELF mode:', error);
      throw new Error(`Microphone access denied: ${error.message}`);
    }
  }
  
  /**
   * Start LISTEN mode (system/speaker audio ONLY - no microphone)
   */
  async startListenMode() {
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
        console.log('LISTEN mode: Audio tracks:', audioTracks.length);
        
        let hasSystemAudio = false;
        audioTracks.forEach(track => {
          console.log('LISTEN mode: Track label:', track.label, 'kind:', track.kind);
          // Check if it's system/desktop audio
          const label = track.label.toLowerCase();
          if (label.includes('desktop') || 
              label.includes('screen') ||
              label.includes('system') ||
              label.includes('speaker') ||
              label.includes('output')) {
            hasSystemAudio = true;
            console.log('LISTEN mode: Found system audio track');
          } else if (label.includes('microphone') || 
                     label.includes('mic') ||
                     label.includes('input')) {
            // This is a microphone track, we don't want it in LISTEN mode
            console.warn('LISTEN mode: Detected microphone track, stopping it');
            track.stop();
          }
        });
        
        if (!hasSystemAudio && audioTracks.length > 0) {
          console.warn('LISTEN mode: No clear system audio detected, but tracks exist');
        }
        
        this.audioStream = stream;
      } catch (displayMediaError) {
        console.warn('getDisplayMedia failed, trying desktopCapturer:', displayMediaError);
        
        // Fallback: Try desktopCapturer API
        const sources = await window.electronAPI.getDesktopSources({ types: ['screen'] });
        
        if (!sources.success || sources.sources.length === 0) {
          throw new Error('No system audio sources available. LISTEN mode requires system audio capture.');
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
              console.warn('LISTEN mode: Detected microphone in desktop capture, stopping it');
              track.stop();
            }
          });
          
          this.audioStream = stream;
        } catch (desktopError) {
          // If both methods fail, show error
          this.showError('System audio capture not available. LISTEN mode requires system/speaker audio, not microphone. Please set up virtual audio capture or use SELF mode for microphone.');
          throw new Error('LISTEN mode requires system audio capture. Use SELF mode for microphone input.');
        }
      }
      
      // Final verification: ensure no microphone tracks
      const finalTracks = this.audioStream.getAudioTracks();
      finalTracks.forEach(track => {
        const label = track.label.toLowerCase();
        if (label.includes('microphone') || label.includes('mic') || label.includes('input')) {
          console.error('LISTEN mode: ERROR - microphone track still present, removing');
          track.stop();
        }
      });
      
      if (this.audioStream.getAudioTracks().length === 0) {
        throw new Error('No system audio tracks available. LISTEN mode requires system/speaker audio.');
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
      
      // Start recording in chunks (every 3 seconds)
      this.mediaRecorder.start(3000);
      
      // Process audio chunks every 3 seconds
      this.transcriptionInterval = setInterval(async () => {
        // Only process if we have new chunks since last processing
        if (this.audioChunks.length > this.lastProcessedChunkIndex && !this.isProcessing) {
          await this.processAudioChunk();
        }
      }, 3000);
      
    } catch (error) {
      console.error('Failed to start LISTEN mode:', error);
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
    
    // Check minimum size (at least 10KB to ensure valid audio)
    const totalSize = newChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    if (totalSize < 10000) {
      // Too small, wait for more data
      return;
    }
    
    this.isProcessing = true;
    this.updateStatus();
    
    try {
      // Combine only the new audio chunks
      const audioBlob = new Blob(newChunks, { type: 'audio/webm' });
      
      // Verify blob is valid
      if (audioBlob.size < 10000) {
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
        
        // Check if it's meaningful speech
        if (this.isMeaningfulSpeech(text)) {
          this.lastTranscription = text;
          this.updateStatus();
          
          if (this.onTranscription) {
            this.onTranscription(text);
          }
          
          // Generate AI response
          await this.generateResponse(text);
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
   * Check if text is meaningful speech
   */
  isMeaningfulSpeech(text) {
    if (!text || text.length < 2) return false;
    
    // Filter out common transcription artifacts
    const noisePatterns = [
      /^[\s\.,!?\-]+$/,  // Only punctuation/whitespace
      /^(uh|um|ah|er|hmm)+$/i,  // Only filler words
      /^[^\w\s]+$/,  // Only special characters
    ];
    
    for (const pattern of noisePatterns) {
      if (pattern.test(text)) {
        return false;
      }
    }
    
    // Check if it has actual words
    const words = text.split(/\s+/).filter(w => w.length > 1);
    return words.length > 0;
  }
  
  /**
   * Generate AI response
   */
  async generateResponse(userText) {
    try {
      // Add to conversation history
      this.conversationHistory.push({
        role: 'user',
        content: userText
      });
      
      // Keep history manageable (last 10 messages)
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-20);
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
      
      // Prepare messages with system prompt
      const systemPrompt = this.mode === 'self' 
        ? 'You are a real-time voice AI assistant. Provide short, clear, conversational responses. Respond naturally as if in a conversation.'
        : 'You are a real-time voice AI assistant listening to system audio. Provide short, clear, helpful responses. If the audio contains questions or meaningful content, answer them conversationally.';
      
      const messages = [
        { role: 'system', content: systemPrompt },
        ...this.conversationHistory
      ];
      
      // Stream response
      this.responseBuffer = '';
      
      // Use streaming API
      try {
        await window.electronAPI.sendAIMessageStream(
          providerConfig,
          messages,
          (chunk) => {
            // Handle error chunks
            if (typeof chunk === 'string' && chunk.startsWith('[ERROR]')) {
              throw new Error(chunk.substring(7));
            }
            
            this.responseBuffer += chunk;
            if (this.onResponse) {
              this.onResponse(this.responseBuffer, false);
            }
          }
        );
        
        // Add assistant response to history
        if (this.responseBuffer) {
          this.conversationHistory.push({
            role: 'assistant',
            content: this.responseBuffer
          });
          
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
        <div class="status-error">❌ ${message}</div>
      `;
      
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
if (typeof window !== 'undefined') {
  window.VoiceAssistant = VoiceAssistant;
}

// Also support CommonJS if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VoiceAssistant;
}

