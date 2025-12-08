/**
 * Renderer Bundle
 * Bundled renderer code for browser execution
 * In production, use webpack/rollup to properly bundle
 */

(function() {
  'use strict';
  
  // Check for electronAPI
  if (typeof window.electronAPI === 'undefined') {
    console.error('electronAPI not available');
    return;
  }
  
  // Simple module system
  const modules = {};
  
  // ChatUI Module
  modules.ChatUI = class ChatUI {
    constructor() {
      this.chatContainer = null;
      this.inputArea = null;
      this.sendButton = null;
      this.messages = [];
      this.currentChatId = 'default';
      this.autoSaveTimer = null;
      this.isBlurred = false;
    }
    
    initialize() {
      this.chatContainer = document.getElementById('chat-messages');
      this.inputArea = document.getElementById('message-input');
      this.sendButton = document.getElementById('send-button');
      
      if (!this.chatContainer || !this.inputArea || !this.sendButton) {
        console.error('Chat UI elements not found');
        return;
      }
      
      this.setupEventListeners();
      this.loadChatHistory();
      this.startAutoSave();
      
      window.electronAPI.onWindowBlur(() => {
        this.handleBlur();
      });
      
      window.electronAPI.onWindowFocus(() => {
        this.handleFocus();
      });
    }
    
    setupEventListeners() {
      this.sendButton.addEventListener('click', () => {
        this.sendMessage();
      });
      
      this.inputArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
          e.preventDefault();
          this.sendMessage();
        }
      });
      
      this.inputArea.addEventListener('input', () => {
        this.inputArea.style.height = 'auto';
        this.inputArea.style.height = `${Math.min(this.inputArea.scrollHeight, 200)}px`;
      });
      
      // Voice input setup
      this.setupVoiceInput();
    }
    
    async setupVoiceInput() {
      this.isListening = false;
      this.recognition = null;
      this.voiceTranscript = '';
      this.voiceStatusEl = document.getElementById('voice-status');
      this.voiceTranscriptEl = document.getElementById('voice-transcript');
      this.listenButton = document.getElementById('listen-button');
      
      if (!this.listenButton) return;
      
      // Check user's voice API preference from settings
      try {
        const configResult = await window.electronAPI.getConfig();
        if (configResult.success && configResult.data) {
          const settings = configResult.data.settings || {};
          const voiceAPI = settings.voiceAPI || 'groq-whisper'; // Default to Groq Whisper (more reliable)
          
          // Check if voice is enabled
          if (settings.voiceEnabled === false) {
            this.listenButton.disabled = true;
            this.listenButton.title = 'Voice input is disabled in Settings';
            return;
          }
          
          // Use the selected API
          if (voiceAPI === 'web-speech') {
            this.setupWebSpeechAPI();
          } else if (voiceAPI === 'openai-whisper' || voiceAPI === 'groq-whisper') {
            this.setupWhisperAPI();
          } else {
            // Default to Whisper if invalid setting
            this.setupWhisperAPI();
          }
          return;
        }
      } catch (e) {
        console.warn('Failed to load voice settings, defaulting to Whisper:', e);
      }
      
      // Default to Whisper if settings not available
      this.setupWhisperAPI();
    }
    
    setupWebSpeechAPI() {
      // Check if browser supports Web Speech API
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true; // Keep listening
        this.recognition.interimResults = true; // Show interim results
        this.recognition.lang = 'en-US'; // Default language
        
        this.recognition.onstart = () => {
          this.isListening = true;
          this.listenButton.textContent = '🛑 Stop';
          this.listenButton.classList.add('listening');
          if (this.voiceStatusEl) {
            this.voiceStatusEl.classList.add('active');
          }
        };
        
        this.recognition.onresult = (event) => {
          let interimTranscript = '';
          let finalTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript + ' ';
            } else {
              interimTranscript += transcript;
            }
          }
          
          this.voiceTranscript = finalTranscript + interimTranscript;
          
          if (this.voiceTranscriptEl) {
            this.voiceTranscriptEl.textContent = this.voiceTranscript || 'Listening...';
          }
          
          // Auto-send when we have final transcript and it's not empty
          if (finalTranscript.trim() && this.isListening) {
            // Small delay to ensure we got the full sentence
            setTimeout(() => {
              if (this.voiceTranscript.trim()) {
                this.sendVoiceMessage(this.voiceTranscript.trim());
                this.voiceTranscript = '';
                if (this.voiceTranscriptEl) {
                  this.voiceTranscriptEl.textContent = '';
                }
              }
            }, 500);
          }
        };
        
        this.recognition.onerror = (event) => {
          // Don't log to console for network errors (they're common and handled gracefully)
          if (event.error !== 'network' && event.error !== 'no-speech') {
            console.error('Speech recognition error:', event.error);
          }
          
          // Handle different error types
          if (event.error === 'no-speech') {
            // No speech detected, continue listening
            return;
          }
          
          if (event.error === 'network') {
            // Network error - Web Speech API may be blocked or unavailable
            this.stopListening();
            
            // Check if we can use Whisper API as fallback
            this.checkWhisperFallback().then(canUseWhisper => {
              if (canUseWhisper) {
            this.showVoiceError(
              'Web Speech API Error:\n' +
              'Your internet works, but Google\'s Speech API is blocked/unavailable.\n\n' +
              'This is common with:\n' +
              '• Corporate firewalls\n' +
              '• Regional restrictions\n' +
              '• Network filters\n\n' +
              'Quick Fix: Go to Settings → Privacy → Voice Input\n' +
              'Change to "OpenAI Whisper" (uses your OpenAI API)'
            );
            
            // Offer to auto-switch if Whisper is available
            if (canUseWhisper) {
              setTimeout(() => {
                if (confirm('Would you like to automatically switch to OpenAI Whisper API?\n\n(This uses your existing OpenAI API key)')) {
                  this.switchToWhisperMode();
                }
              }, 1000);
            }
              } else {
                this.showVoiceError(
                  'Web Speech API Error: Service may be blocked or unavailable.\n\n' +
                  'Your internet works (chat is working), but Web Speech API needs:\n' +
                  '1. Access to Google\'s speech service\n' +
                  '2. May be blocked by firewall/corporate network\n\n' +
                  'Solution: Switch to Whisper API in Settings → Privacy → Voice Input\n' +
                  'Change to "Groq Whisper" or "OpenAI Whisper"'
                );
                
                // Automatically switch to Whisper if available
                setTimeout(() => {
                  this.checkWhisperFallback().then(canUseWhisper => {
                    if (canUseWhisper) {
                      if (confirm('Would you like to automatically switch to Whisper API? (More reliable than Web Speech)')) {
                        this.switchToWhisperMode();
                      }
                    }
                  });
                }, 2000);
              }
            });
            return;
          }
          
          if (event.error === 'not-allowed') {
            this.stopListening();
            this.showVoiceError(
              'Microphone permission denied.\n\n' +
              'Please allow microphone access in your browser settings.'
            );
            return;
          }
          
          if (event.error === 'service-not-allowed') {
            this.stopListening();
            this.showVoiceError(
              'Speech recognition service not available.\n\n' +
              'This may be due to:\n' +
              '1. Browser restrictions\n' +
              '2. Network issues\n' +
              '3. Try using OpenAI Whisper API instead'
            );
            return;
          }
          
          // Other errors
          this.stopListening();
          this.showVoiceError('Voice recognition error: ' + event.error);
        };
        
        this.recognition.onend = () => {
          if (this.isListening) {
            // Restart if still supposed to be listening
            try {
              this.recognition.start();
            } catch (e) {
              // Already started or error
              this.stopListening();
            }
          }
        };
        
        // Listen button click
        this.listenButton.addEventListener('click', () => {
          if (this.isListening) {
            this.stopListening();
          } else {
            this.startListening();
          }
        });
        
        // Keyboard shortcut CTRL+L
        document.addEventListener('keydown', (e) => {
          if (e.ctrlKey && e.key === 'l' && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            if (this.isListening) {
              this.stopListening();
            } else {
              this.startListening();
            }
          }
        });
      } else {
        // Browser doesn't support Web Speech API - try Whisper
        console.warn('Web Speech API not supported, checking for Whisper fallback');
        this.checkWhisperFallback().then(canUseWhisper => {
          if (canUseWhisper) {
            this.setupWhisperAPI();
          } else {
            // No fallback available
            if (this.listenButton) {
              this.listenButton.title = 'Voice input not available. Web Speech API not supported and no OpenAI API key configured.';
              this.listenButton.disabled = true;
              this.listenButton.style.opacity = '0.5';
            }
          }
        });
      }
    }
    
    setupWhisperAPI() {
      // Whisper API using MediaRecorder to capture audio
      this.mediaRecorder = null;
      this.audioChunks = [];
      this.isRecording = false;
      
      if (!this.listenButton) return;
      
      // Check if MediaRecorder is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.listenButton.disabled = true;
        this.listenButton.title = 'Microphone access not available in this browser';
        this.showVoiceError('MediaRecorder API not supported. Please use a modern browser.');
        return;
      }
      
      this.listenButton.textContent = '🎤 Listen';
      this.listenButton.title = 'Start voice input with OpenAI Whisper (CTRL+L)';
      
      // Listen button click
      this.listenButton.addEventListener('click', () => {
        if (this.isRecording) {
          this.stopWhisperRecording();
        } else {
          this.startWhisperRecording();
        }
      });
      
      // Keyboard shortcut CTRL+L
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'l' && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          if (this.isRecording) {
            this.stopWhisperRecording();
          } else {
            this.startWhisperRecording();
          }
        }
      });
    }
    
    async startWhisperRecording() {
      try {
        // Check if voice is enabled
        const configResult = await window.electronAPI.getConfig();
        if (configResult.success && configResult.data) {
          const settings = configResult.data.settings || {};
          if (settings.voiceEnabled === false) {
            this.showVoiceError('Voice input is disabled in Settings.');
            return;
          }
        }
        
        // Get microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Create MediaRecorder
        this.mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus'
        });
        
        this.audioChunks = [];
        
        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this.audioChunks.push(event.data);
          }
        };
        
        this.mediaRecorder.onstop = async () => {
          // Stop all tracks
          stream.getTracks().forEach(track => track.stop());
          
          // Create blob from chunks
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          
          // Convert to buffer for IPC
          const arrayBuffer = await audioBlob.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          
          // Get OpenAI API key
          const configResult = await window.electronAPI.getConfig();
          if (!configResult.success || !configResult.data) {
            this.showVoiceError('Failed to load configuration.');
            return;
          }
          
          const accounts = configResult.data.accounts || [];
          
          // Find account with Whisper support (OpenAI or Groq)
          // For Groq, any account can be used for Whisper (it's separate endpoint)
          let apiAccount = accounts.find(acc => {
            if (acc.type === 'openai' && acc.apiKey && acc.apiKey.trim() !== '') {
              return true;
            }
            if (acc.type === 'groq' && acc.apiKey && acc.apiKey.trim() !== '') {
              // Groq supports Whisper with any account (whisper endpoint is separate)
              return true;
            }
            return false;
          });
          
          if (!apiAccount || !apiAccount.apiKey) {
            this.showVoiceError(
              'No API key found for Whisper transcription.\n\n' +
              'Please add an OpenAI or Groq account with Whisper model in Settings → AI Accounts.\n\n' +
              'For Groq: Use whisper-large-v3 or whisper-large-v3-turbo model'
            );
            return;
          }
          
          // Show processing status
          if (this.voiceStatusEl) {
            this.voiceStatusEl.innerHTML = `
              <div>🔄 Processing audio...</div>
              <div class="voice-text" style="color: #4caf50;">Sending to Whisper API</div>
            `;
            this.voiceStatusEl.classList.add('active');
          }
          
          // Send to Whisper API via IPC
          try {
            // Get Whisper model from settings
            const configForModel = await window.electronAPI.getConfig();
            const settingsForModel = configForModel.success && configForModel.data ? (configForModel.data.settings || {}) : {};
            let whisperModel = settingsForModel.whisperModel;
            
            // Default models if not set in settings
            if (!whisperModel) {
              if (apiAccount.type === 'groq') {
                whisperModel = 'whisper-large-v3-turbo';
              } else {
                whisperModel = 'whisper-1';
              }
            }
            
            const result = await window.electronAPI.transcribeAudio(
              buffer,
              apiAccount.apiKey,
              apiAccount.type || 'openai',
              whisperModel
            );
            
            if (result.success && result.text) {
              // Clear status
              if (this.voiceStatusEl) {
                this.voiceStatusEl.classList.remove('active');
              }
              
              // Send transcribed text to AI
              this.sendVoiceMessage(result.text.trim());
            } else {
              this.showVoiceError('Transcription failed: ' + (result.error || 'Unknown error'));
            }
          } catch (error) {
            this.showVoiceError('Failed to transcribe: ' + error.message);
          }
        };
        
        // Start recording
        this.mediaRecorder.start(1000); // Collect data every second
        this.isRecording = true;
        
        // Update UI
        this.listenButton.textContent = '🛑 Stop';
        this.listenButton.classList.add('listening');
        
        if (this.voiceStatusEl) {
          this.voiceStatusEl.innerHTML = `
            <div>🎤 Recording...</div>
            <div class="voice-text" id="voice-transcript">Speak now...</div>
          `;
          this.voiceStatusEl.classList.add('active');
        }
        
      } catch (error) {
        console.error('Failed to start recording:', error);
        if (error.name === 'NotAllowedError') {
          this.showVoiceError(
            'Microphone permission denied.\n\n' +
            'Please allow microphone access in your browser settings.'
          );
        } else if (error.name === 'NotFoundError') {
          this.showVoiceError('No microphone found. Please connect a microphone.');
        } else {
          this.showVoiceError('Failed to start recording: ' + error.message);
        }
      }
    }
    
    stopWhisperRecording() {
      if (this.mediaRecorder && this.isRecording) {
        this.mediaRecorder.stop();
        this.isRecording = false;
        
        // Update UI
        this.listenButton.textContent = '🎤 Listen';
        this.listenButton.classList.remove('listening');
      }
    }
    
    async startListening() {
      if (!this.recognition) {
        this.showVoiceError('Voice recognition not available. Please check your browser support.');
        return;
      }
      
      if (this.isListening) {
        return; // Already listening
      }
      
      // Check if voice is enabled in settings
      try {
        const configResult = await window.electronAPI.getConfig();
        if (configResult.success && configResult.data) {
          const settings = configResult.data.settings || {};
          if (settings.voiceEnabled === false) {
            this.showVoiceError('Voice input is disabled in Settings. Enable it in Settings → Privacy → Voice Input.');
            return;
          }
        }
      } catch (e) {
        // Continue if config check fails
      }
      
      this.voiceTranscript = '';
      try {
        this.recognition.start();
      } catch (e) {
        console.error('Failed to start recognition:', e);
        if (e.message && e.message.includes('already started')) {
          // Recognition already running, just update UI
          this.isListening = true;
          this.listenButton.textContent = '🛑 Stop';
          this.listenButton.classList.add('listening');
          if (this.voiceStatusEl) {
            this.voiceStatusEl.classList.add('active');
          }
        } else {
          this.showVoiceError('Failed to start voice recognition: ' + e.message);
        }
      }
    }
    
    stopListening() {
      if (this.recognition && this.isListening) {
        this.isListening = false;
        try {
          this.recognition.stop();
        } catch (e) {
          // Ignore errors
        }
        this.listenButton.textContent = '🎤 Listen';
        this.listenButton.classList.remove('listening');
        if (this.voiceStatusEl) {
          this.voiceStatusEl.classList.remove('active');
        }
        if (this.voiceTranscriptEl) {
          this.voiceTranscriptEl.textContent = '';
        }
      }
    }
    
    sendVoiceMessage(text) {
      if (!text || !text.trim()) return;
      
      // Add user message
      this.addMessage('user', text);
      
      // Trigger AI response
      window.dispatchEvent(new CustomEvent('chat-send-message', {
        detail: { content: text }
      }));
    }
    
    async checkWhisperFallback() {
      try {
        const configResult = await window.electronAPI.getConfig();
        if (configResult.success && configResult.data) {
          const accounts = configResult.data.accounts || [];
          // Check if there's a Groq or OpenAI account with API key
          const hasGroq = accounts.some(acc => 
            acc.type === 'groq' && acc.apiKey && acc.apiKey.trim() !== ''
          );
          const hasOpenAI = accounts.some(acc => 
            acc.type === 'openai' && acc.apiKey && acc.apiKey.trim() !== ''
          );
          return hasGroq || hasOpenAI;
        }
      } catch (e) {
        console.error('Failed to check Whisper fallback:', e);
      }
      return false;
    }
    
    async switchToWhisperMode() {
      try {
        const configResult = await window.electronAPI.getConfig();
        if (configResult.success && configResult.data) {
          if (!configResult.data.settings) {
            configResult.data.settings = {};
          }
          
          // Check if Groq account exists (prefer Groq as it's faster)
          const accounts = configResult.data.accounts || [];
          const hasGroq = accounts.some(acc => acc.type === 'groq' && acc.apiKey && acc.apiKey.trim() !== '');
          
          // Prefer Groq Whisper if available, otherwise OpenAI Whisper
          configResult.data.settings.voiceAPI = hasGroq ? 'groq-whisper' : 'openai-whisper';
          await window.electronAPI.saveConfig(configResult.data);
          
          // Reload voice input with Whisper
          this.setupVoiceInput();
          
          // Show success message
          if (this.voiceStatusEl) {
            this.voiceStatusEl.innerHTML = `
              <div style="color: #4caf50;">✓ Switched to ${hasGroq ? 'Groq' : 'OpenAI'} Whisper API</div>
              <div class="voice-text" style="color: #999; font-size: 12px;">Click Listen button to try again</div>
            `;
            this.voiceStatusEl.classList.add('active');
            setTimeout(() => {
              if (this.voiceStatusEl) {
                this.voiceStatusEl.classList.remove('active');
              }
            }, 3000);
          }
        }
      } catch (e) {
        console.error('Failed to switch to Whisper:', e);
      }
    }
    
    showVoiceError(message) {
      // Show error in voice status area
      if (this.voiceStatusEl) {
        this.voiceStatusEl.innerHTML = `
          <div style="color: #ff6b6b;">❌ Error</div>
          <div style="color: #ff6b6b; font-size: 12px; margin-top: 8px; white-space: pre-line;">${message}</div>
        `;
        this.voiceStatusEl.classList.add('active', 'error');
        
        // Hide after 8 seconds (longer for important messages)
        setTimeout(() => {
          if (this.voiceStatusEl) {
            this.voiceStatusEl.classList.remove('active', 'error');
          }
        }, 8000);
      } else {
        // Fallback to alert
        alert(message);
      }
    }
    
    addMessage(role, content) {
      const message = {
        role,
        content,
        timestamp: new Date().toISOString()
      };
      
      this.messages.push(message);
      this.renderMessage(message);
      this.autoScroll();
      this.scheduleAutoSave();
    }
    
    updateLastAssistantMessage(content) {
      if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'assistant') {
        this.messages[this.messages.length - 1].content = content;
        this.rerenderMessages();
        this.autoScroll();
      }
    }
    
    renderMessage(message) {
      const messageDiv = document.createElement('div');
      messageDiv.className = `message message-${message.role}`;
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      
      // Render Markdown
      const html = window.electronAPI.renderMarkdown(message.content);
      contentDiv.innerHTML = html;
      
      const timestampDiv = document.createElement('div');
      timestampDiv.className = 'message-timestamp';
      const date = new Date(message.timestamp);
      timestampDiv.textContent = date.toLocaleTimeString();
      
      messageDiv.appendChild(contentDiv);
      messageDiv.appendChild(timestampDiv);
      
      this.chatContainer.appendChild(messageDiv);
    }
    
    rerenderMessages() {
      this.chatContainer.innerHTML = '';
      this.messages.forEach(msg => this.renderMessage(msg));
    }
    
    autoScroll() {
      this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
    
    async sendMessage() {
      const content = this.inputArea.value.trim();
      if (!content) return;
      
      this.inputArea.value = '';
      this.inputArea.style.height = 'auto';
      
      this.addMessage('user', content);
      
      window.dispatchEvent(new CustomEvent('chat-send-message', {
        detail: { content }
      }));
    }
    
    async loadChatHistory() {
      try {
        const result = await window.electronAPI.loadChat(this.currentChatId);
        if (result.success && result.data) {
          this.messages = result.data;
          this.rerenderMessages();
          this.autoScroll();
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
        if (window.logsPanel) {
          window.logsPanel.addLog('error', 'Failed to load chat history: ' + error.message, error.stack);
        }
      }
    }
    
    async saveChatHistory() {
      try {
        await window.electronAPI.saveChat(this.currentChatId, this.messages);
      } catch (error) {
        console.error('Failed to save chat history:', error);
        if (window.logsPanel) {
          window.logsPanel.addLog('error', 'Failed to save chat history: ' + error.message, error.stack);
        }
      }
    }
    
    scheduleAutoSave() {
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
      }
      
      this.autoSaveTimer = setTimeout(() => {
        this.saveChatHistory();
      }, 10000);
    }
    
    startAutoSave() {
      setInterval(() => {
        if (this.messages.length > 0) {
          this.saveChatHistory();
        }
      }, 30000);
    }
    
    handleBlur() {
      this.isBlurred = true;
      document.body.classList.add('blurred');
    }
    
    handleFocus() {
      this.isBlurred = false;
      document.body.classList.remove('blurred');
    }
  };
  
  // AuthModal Module (simplified)
  modules.AuthModal = class AuthModal {
    constructor() {
      this.modal = null;
      this.setupMode = false;
      this.onSuccess = null;
    }
    
    async show(isSetup = false, onSuccess = null) {
      this.setupMode = isSetup;
      this.onSuccess = onSuccess;
      
      const modalHTML = `
        <div id="auth-modal" class="auth-modal-overlay">
          <div class="auth-modal-content">
            <h2>${isSetup ? 'Setup Master Password' : 'Enter Master Password'}</h2>
            <p class="auth-modal-description">
              ${isSetup 
                ? 'Create a master password to encrypt your chat data. This password cannot be recovered.'
                : 'Enter your master password to unlock the application.'}
            </p>
            <form id="auth-form">
              <div class="auth-input-group">
                <label for="password-input">Password</label>
                <input 
                  type="password" 
                  id="password-input" 
                  autocomplete="off"
                  placeholder="${isSetup ? 'Minimum 12 characters' : 'Enter password'}"
                  required
                  minlength="${isSetup ? 12 : 1}"
                />
                ${isSetup ? `
                  <div class="auth-input-group">
                    <label for="password-confirm">Confirm Password</label>
                    <input 
                      type="password" 
                      id="password-confirm" 
                      autocomplete="off"
                      placeholder="Confirm password"
                      required
                    />
                  </div>
                ` : ''}
              </div>
              <div id="auth-error" class="auth-error" style="display: none;"></div>
              <button type="submit" id="auth-submit" class="auth-submit-btn">
                ${isSetup ? 'Setup Password' : 'Unlock'}
              </button>
            </form>
          </div>
        </div>
      `;
      
      document.body.insertAdjacentHTML('beforeend', modalHTML);
      this.modal = document.getElementById('auth-modal');
      
      const form = document.getElementById('auth-form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSubmit();
      });
      
      document.getElementById('password-input').focus();
    }
    
    async handleSubmit() {
      const password = document.getElementById('password-input').value;
      const passwordConfirm = this.setupMode 
        ? document.getElementById('password-confirm')?.value 
        : password;
      const errorDiv = document.getElementById('auth-error');
      const submitBtn = document.getElementById('auth-submit');
      
      // Validate
      if (this.setupMode && password !== passwordConfirm) {
        errorDiv.textContent = 'Passwords do not match';
        errorDiv.style.display = 'block';
        return;
      }
      
      if (this.setupMode && password.length < 12) {
        errorDiv.textContent = 'Password must be at least 12 characters';
        errorDiv.style.display = 'block';
        return;
      }
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Processing...';
      errorDiv.style.display = 'none';
      
      try {
        let result;
        
        if (this.setupMode) {
          result = await window.electronAPI.setupPassword(password);
        } else {
          result = await window.electronAPI.verifyPassword(password);
        }
        
        if (result.success) {
          this.hide();
          if (this.onSuccess) {
            this.onSuccess();
          }
        } else {
          errorDiv.textContent = result.error || 'Authentication failed';
          errorDiv.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = this.setupMode ? 'Setup Password' : 'Unlock';
        }
      } catch (error) {
        errorDiv.textContent = `Error: ${error.message}`;
        errorDiv.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = this.setupMode ? 'Setup Password' : 'Unlock';
      }
      
      document.getElementById('password-input').value = '';
    }
    
    hide() {
      if (this.modal) {
        this.modal.remove();
        this.modal = null;
      }
    }
  };
  
  // SettingsPanel Module
  modules.SettingsPanel = class SettingsPanel {
    constructor() {
      this.panel = null;
      this.isOpen = false;
      this.config = null;
    }
    
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
    
    async show() {
      if (this.isOpen) return;
      
      await this.loadConfig();
      
      const panelHTML = `
        <div id="settings-panel" class="settings-panel-overlay">
          <div class="settings-panel-content">
            <div class="settings-header">
              <h2>Settings</h2>
              <button id="settings-close" class="settings-close-btn">×</button>
            </div>
            <div class="settings-body">
              <div class="settings-tabs">
                <button class="settings-tab active" data-tab="accounts">AI Accounts</button>
                <button class="settings-tab" data-tab="privacy">Privacy</button>
              </div>
              
              <div class="settings-tab-content" id="accounts-tab">
                ${this.renderAccountsTab()}
              </div>
              
              <div class="settings-tab-content" id="privacy-tab" style="display: none;">
                ${this.renderPrivacyTab()}
              </div>
            </div>
          </div>
        </div>
      `;
      
      document.body.insertAdjacentHTML('beforeend', panelHTML);
      this.panel = document.getElementById('settings-panel');
      this.isOpen = true;
      
      document.getElementById('settings-close').addEventListener('click', () => {
        this.hide();
      });
      
      this.panel.addEventListener('click', (e) => {
        if (e.target === this.panel) {
          this.hide();
        }
      });
      
      this.setupFormHandlers();
    }
    
    renderAccountsTab() {
      const accounts = this.config.accounts || [];
      
      return `
        <div class="accounts-list" style="margin-bottom: 20px;">
          ${accounts.map((acc, idx) => `
            <div class="account-item">
              <div class="account-info">
                <strong>${acc.name || 'Untitled Account'}</strong>
                <span class="account-type">${acc.type}</span>
              </div>
              <button class="account-edit-btn" data-index="${idx}" style="background: #0066cc; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-right: 8px;">Edit</button>
              <button class="account-delete-btn" data-index="${idx}" style="background: #cc0000; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Delete</button>
            </div>
          `).join('')}
          ${accounts.length === 0 ? '<p style="color: #999; margin-bottom: 20px;">No accounts configured. Add one below.</p>' : ''}
        </div>
        
        <button id="add-account-btn" class="add-account-btn">+ Add Account</button>
        
        <div id="account-form" class="account-form" style="display: none; margin-top: 20px; padding: 20px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px;">
          <h3 style="margin-bottom: 16px;">Add/Edit Account</h3>
          <form id="account-form-content">
            <input type="hidden" id="account-index" value="-1" />
            
            <div class="form-group">
              <label>Account Name</label>
              <input type="text" id="account-name" required style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 10px; border-radius: 6px; margin-top: 8px;" />
            </div>
            
            <div class="form-group">
              <label>Provider Type</label>
              <select id="account-type" required style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 10px; border-radius: 6px; margin-top: 8px;">
                <option value="openai">OpenAI</option>
                <option value="groq">Groq (Fast & Affordable)</option>
                <option value="ollama">Ollama (Local)</option>
                <option value="openai-compatible">OpenAI-Compatible</option>
              </select>
            </div>
            
            <div class="form-group" id="api-key-group">
              <label>API Key</label>
              <input type="password" id="account-api-key" placeholder="Enter API key" style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 10px; border-radius: 6px; margin-top: 8px;" />
              <small style="display: block; margin-top: 4px; color: #999; font-size: 12px;">Leave empty for local providers like Ollama</small>
            </div>
            
            <div class="form-group">
              <label>Model</label>
              <select id="account-model" required style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 10px; border-radius: 6px; margin-top: 8px;">
                <option value="">Select a model...</option>
              </select>
              <small style="display: block; margin-top: 4px; color: #999; font-size: 12px;">Or type custom model name</small>
              <input type="text" id="account-model-custom" placeholder="Or enter custom model name" style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 10px; border-radius: 6px; margin-top: 8px; display: none;" />
            </div>
            
            <div class="form-group" id="base-url-group" style="display: none;">
              <label>Base URL</label>
              <input type="text" id="account-base-url" placeholder="Leave empty for defaults" style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 10px; border-radius: 6px; margin-top: 8px;" />
            </div>
            
            <div class="form-actions" style="margin-top: 20px;">
              <button type="submit" class="save-btn">Save</button>
              <button type="button" class="cancel-btn" id="cancel-account-form">Cancel</button>
            </div>
          </form>
        </div>
      `;
    }
    
    renderPrivacyTab() {
      const settings = this.config.settings || {};
      
      return `
        <div class="settings-section">
          <h3>Auto-Lock</h3>
          <div class="setting-item" style="margin-bottom: 16px;">
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" id="auto-lock" ${settings.autoLock !== false ? 'checked' : ''} />
              Enable auto-lock on idle
            </label>
          </div>
          <div class="setting-item" style="margin-bottom: 16px;">
            <label>
              Auto-lock after (minutes):
              <input type="number" id="auto-lock-minutes" value="${settings.autoLockMinutes || 15}" min="1" max="60" style="margin-left: 8px; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 6px; border-radius: 4px; width: 80px;" />
            </label>
          </div>
        </div>
        
        <div class="settings-section">
          <h3>Privacy</h3>
          <div class="setting-item" style="margin-bottom: 16px;">
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" id="auto-blur" ${settings.autoBlur ? 'checked' : ''} />
              Blur chat when window loses focus
            </label>
          </div>
        </div>
        
        <div class="settings-section">
          <h3>Window Behavior</h3>
          <div class="setting-item" style="margin-bottom: 16px;">
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" id="always-on-top" ${settings.alwaysOnTop !== false ? 'checked' : ''} />
              Always keep window on top
            </label>
            <small style="display: block; margin-top: 4px; color: #999; font-size: 12px;">
              Hide/Show: CTRL+ALT+H
            </small>
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
              Click the 🎤 Listen button to use voice input
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
              For Groq: Use whisper-large-v3-turbo (fastest). For OpenAI: Use whisper-1
            </small>
          </div>
          <div style="background: #2a2a2a; padding: 12px; border-radius: 6px; margin-top: 12px;">
            <strong style="color: #4CAF50;">💡 Tip for Testing:</strong>
            <div style="margin-top: 8px; font-size: 13px; color: #ccc; line-height: 1.5;">
              <div><strong>Best for testing:</strong> Groq Whisper with <code style="background: #1a1a1a; padding: 2px 6px; border-radius: 3px;">whisper-large-v3-turbo</code></div>
              <div style="margin-top: 6px;">• Fast and accurate</div>
              <div>• Affordable pricing</div>
              <div>• Low latency</div>
              <div style="margin-top: 8px;"><strong>Setup:</strong> Add a Groq account in AI Accounts tab with any chat model (e.g., llama-3.1-8b-instant). The Whisper model is selected here in Voice Input settings.</div>
            </div>
          </div>
        </div>
        
        <div class="settings-actions" style="margin-top: 24px;">
          <button id="save-privacy-settings" class="save-btn">Save Settings</button>
        </div>
      `;
    }
    
    setupFormHandlers() {
      // Tab switching
      document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const tabName = tab.dataset.tab;
          document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
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
          
          // Update model dropdown when provider type changes
          this.updateModelDropdown(type);
          
          if (type === 'ollama') {
            apiKeyGroup.style.display = 'none';
            baseUrlGroup.style.display = 'block';
            document.getElementById('account-base-url').placeholder = 'http://localhost:11434';
          } else if (type === 'openai' || type === 'groq') {
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
          // Clear form
          document.getElementById('account-name').value = '';
          document.getElementById('account-type').value = 'openai';
          document.getElementById('account-api-key').value = '';
          document.getElementById('account-model').value = '';
          document.getElementById('account-base-url').value = '';
        });
      }
      
      // Cancel button
      const cancelBtn = document.getElementById('cancel-account-form');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          document.getElementById('account-form').style.display = 'none';
        });
      }
      
      // Edit/Delete buttons
      document.querySelectorAll('.account-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const index = parseInt(btn.dataset.index);
          const account = this.config.accounts[index];
          document.getElementById('account-form').style.display = 'block';
          document.getElementById('account-index').value = index;
          document.getElementById('account-name').value = account.name || '';
          document.getElementById('account-type').value = account.type || 'openai';
          document.getElementById('account-api-key').value = ''; // Don't show existing key
          document.getElementById('account-base-url').value = account.baseURL || '';
          
          // Update model dropdown first
          this.updateModelDropdown(account.type || 'openai');
          
          // Set model value (check if it's in dropdown or use custom)
          const modelSelect = document.getElementById('account-model');
          const modelCustomInput = document.getElementById('account-model-custom');
          const savedModel = account.model || '';
          
          if (modelSelect) {
            // Check if model exists in dropdown
            const optionExists = Array.from(modelSelect.options).some(opt => opt.value === savedModel);
            if (optionExists) {
              modelSelect.value = savedModel;
              if (modelCustomInput) {
                modelCustomInput.style.display = 'none';
                modelCustomInput.value = '';
              }
            } else {
              // Use custom input
              modelSelect.value = '__custom__';
              if (modelCustomInput) {
                modelCustomInput.value = savedModel;
                modelCustomInput.style.display = 'block';
              }
            }
          }
          
          // Trigger type change to update visibility
          document.getElementById('account-type').dispatchEvent(new Event('change'));
        });
      });
      
      document.querySelectorAll('.account-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Are you sure you want to delete this account?')) {
            const index = parseInt(btn.dataset.index);
            this.config.accounts.splice(index, 1);
            await this.saveConfig();
            this.hide();
            this.show(); // Refresh
          }
        });
      });
      
      // Account form submit
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
      
      // Always on top checkbox handler
      const alwaysOnTopCheckbox = document.getElementById('always-on-top');
      if (alwaysOnTopCheckbox) {
        alwaysOnTopCheckbox.addEventListener('change', async (e) => {
          const result = await window.electronAPI.toggleAlwaysOnTop();
          if (result.success) {
            // Update checkbox to match actual state
            alwaysOnTopCheckbox.checked = result.alwaysOnTop;
            // Save to config
            if (!this.config.settings) {
              this.config.settings = {};
            }
            this.config.settings.alwaysOnTop = result.alwaysOnTop;
            await this.saveConfig();
          }
        });
        
        // Load current state on show
        window.electronAPI.getAlwaysOnTop().then(result => {
          if (result.success) {
            alwaysOnTopCheckbox.checked = result.alwaysOnTop;
          }
        });
      }
    }
    
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
        case 'groq':
          // Include chat completion models and Whisper models
          models = [
            { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (Recommended)' },
            { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
            { value: 'llama-3.2-90b-text-preview', label: 'Llama 3.2 90B Text Preview' },
            { value: 'llama-3.2-11b-text-preview', label: 'Llama 3.2 11B Text Preview' },
            { value: 'llama-3.2-3b-text-preview', label: 'Llama 3.2 3B Text Preview' },
            { value: 'llama-3.2-1b-text-preview', label: 'Llama 3.2 1B Text Preview' },
            { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B 32K' },
            { value: 'gemma-7b-it', label: 'Gemma 7B IT' },
            { value: 'gemma2-9b-it', label: 'Gemma 2 9B IT' },
            { value: 'gemma2-27b-it', label: 'Gemma 2 27B IT' },
            { value: '', label: '--- Whisper Models (Audio Only) ---', disabled: true },
            { value: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (Audio Transcription)' },
            { value: 'whisper-large-v3', label: 'Whisper Large v3 (Audio Transcription)' }
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
        if (model.disabled) {
          option.disabled = true;
          option.style.color = '#666';
        }
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
    
    setupModelDropdownListener() {
      const modelSelect = document.getElementById('account-model');
      const modelCustomInput = document.getElementById('account-model-custom');
      
      if (!modelSelect) return;
      
      // Remove existing listeners by cloning (prevents duplicate listeners)
      const newSelect = modelSelect.cloneNode(true);
      if (modelSelect.parentNode) {
        modelSelect.parentNode.replaceChild(newSelect, modelSelect);
      }
      
      const updatedSelect = document.getElementById('account-model');
      if (updatedSelect) {
        updatedSelect.addEventListener('change', () => {
          const selectedValue = updatedSelect.value;
          const customInput = document.getElementById('account-model-custom');
          
          if (selectedValue === '__custom__') {
            // Show custom input
            if (customInput) {
              customInput.style.display = 'block';
              customInput.required = true;
              customInput.focus();
              updatedSelect.required = false;
            }
          } else {
            // Hide custom input
            if (customInput) {
              customInput.style.display = 'none';
              customInput.required = false;
              customInput.value = '';
              updatedSelect.required = true;
            }
          }
        });
      }
    }
    
    async saveAccount() {
      const index = parseInt(document.getElementById('account-index').value);
      const modelSelect = document.getElementById('account-model');
      const modelCustomInput = document.getElementById('account-model-custom');
      
      // Get model value (from dropdown or custom input)
      let modelValue = modelSelect.value;
      if (modelValue === '__custom__' && modelCustomInput) {
        modelValue = modelCustomInput.value.trim();
      }
      
      if (!modelValue) {
        alert('Please select or enter a model name');
        return;
      }
      
      const account = {
        name: document.getElementById('account-name').value,
        type: document.getElementById('account-type').value,
        model: modelValue,
        apiKey: document.getElementById('account-api-key').value || '',
        baseURL: document.getElementById('account-base-url').value || undefined
      };
      
      // If editing and API key is empty, preserve existing key
      if (index >= 0 && !account.apiKey && this.config.accounts[index]) {
        account.apiKey = this.config.accounts[index].apiKey || '';
      }
      
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
      
      this.hide();
      
      // Notify main app to refresh
      window.dispatchEvent(new CustomEvent('config-updated'));
      
      alert('Account saved successfully! The provider dropdown will update automatically.');
    }
    
    async savePrivacySettings() {
      if (!this.config.settings) {
        this.config.settings = {};
      }
      
      this.config.settings.autoLock = document.getElementById('auto-lock').checked;
      this.config.settings.autoLockMinutes = parseInt(document.getElementById('auto-lock-minutes').value);
      this.config.settings.autoBlur = document.getElementById('auto-blur').checked;
      
      // Get always on top state
      const alwaysOnTopCheckbox = document.getElementById('always-on-top');
      if (alwaysOnTopCheckbox) {
        this.config.settings.alwaysOnTop = alwaysOnTopCheckbox.checked;
      }
      
      // Get voice settings
      const voiceEnabledCheckbox = document.getElementById('voice-enabled');
      if (voiceEnabledCheckbox) {
        this.config.settings.voiceEnabled = voiceEnabledCheckbox.checked;
      }
      
      const voiceAPI = document.getElementById('voice-api');
      if (voiceAPI) {
        this.config.settings.voiceAPI = voiceAPI.value;
      }
      
      const whisperModel = document.getElementById('whisper-model');
      if (whisperModel) {
        this.config.settings.whisperModel = whisperModel.value;
      }
      
      await this.saveConfig();
      alert('Settings saved');
    }
    
    async saveConfig() {
      try {
        const result = await window.electronAPI.saveConfig(this.config);
        if (!result.success) {
          throw new Error(result.error);
        }
      } catch (error) {
        console.error('Failed to save config:', error);
        if (window.logsPanel) {
          window.logsPanel.addLog('error', 'Failed to save config: ' + error.message, error.stack);
        }
        alert('Failed to save settings: ' + error.message);
      }
    }
    
    hide() {
      if (this.panel) {
        this.panel.remove();
        this.panel = null;
        this.isOpen = false;
      }
    }
  };
  
  // Main Application
  let chatUI = null;
  let authModal = null;
  let settingsPanel = null;
  let currentProviderId = null;
  let config = null;
  
  async function initialize() {
    const sessionStatus = await window.electronAPI.getSessionStatus();
    
    if (sessionStatus.needsSetup) {
      // First time setup
      await showAuthModal(true);
    } else if (!sessionStatus.authenticated) {
      // Login
      await showAuthModal(false);
    } else {
      // Already authenticated
      await loadApplication();
    }
  }
  
  async function showAuthModal(isSetup = false) {
    authModal = new modules.AuthModal();
    
    authModal.show(isSetup, async () => {
      await loadApplication();
    });
  }
  
  // LogsPanel Module
  modules.LogsPanel = class LogsPanel {
    constructor() {
      this.panel = null;
      this.isOpen = false;
      this.logs = [];
      this.maxLogs = 1000;
      this.filterLevel = 'all';
    }
    
    initialize() {
      this.setupErrorHandling();
      this.loadLogs();
    }
    
    setupErrorHandling() {
      const originalError = console.error;
      const originalWarn = console.warn;
      
      console.error = (...args) => {
        this.addLog('error', args.join(' '), new Error().stack);
        originalError.apply(console, args);
      };
      
      console.warn = (...args) => {
        this.addLog('warning', args.join(' '));
        originalWarn.apply(console, args);
      };
      
      window.addEventListener('error', (event) => {
        this.addLog('error', event.message, event.error?.stack, {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });
      });
      
      window.addEventListener('unhandledrejection', (event) => {
        this.addLog('error', `Unhandled Promise Rejection: ${event.reason}`, event.reason?.stack);
      });
    }
    
    addLog(level, message, stack = null, details = null) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: level.toLowerCase(),
        message: message || 'No message',
        stack: stack || null,
        details: details || null
      };
      
      this.logs.push(logEntry);
      if (this.logs.length > this.maxLogs) {
        this.logs.shift();
      }
      
      this.saveLogs();
      
      if (this.isOpen && this.panel) {
        this.renderLogs();
      }
    }
    
    show() {
      if (this.isOpen) return;
      
      const panelHTML = `
        <div id="logs-panel" class="logs-panel-overlay">
          <div class="logs-panel-content">
            <div class="logs-header">
              <h2>Application Logs</h2>
              <div class="logs-controls">
                <button id="logs-clear" class="logs-clear-btn">Clear Logs</button>
                <button id="logs-close" class="logs-close-btn">× Close</button>
              </div>
            </div>
            <div class="logs-filter">
              <label style="color: #e0e0e0; font-size: 14px;">Filter:</label>
              <select id="logs-filter-level">
                <option value="all">All Logs</option>
                <option value="error">Errors Only</option>
                <option value="warning">Warnings</option>
                <option value="info">Info</option>
                <option value="success">Success</option>
              </select>
              <span id="logs-count" style="color: #999; font-size: 12px; margin-left: auto;"></span>
            </div>
            <div class="logs-body" id="logs-content"></div>
          </div>
        </div>
      `;
      
      document.body.insertAdjacentHTML('beforeend', panelHTML);
      this.panel = document.getElementById('logs-panel');
      this.isOpen = true;
      
      document.getElementById('logs-close').addEventListener('click', () => {
        this.hide();
      });
      
      document.getElementById('logs-clear').addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all logs?')) {
          this.clearLogs();
        }
      });
      
      document.getElementById('logs-filter-level').addEventListener('change', (e) => {
        this.filterLevel = e.target.value;
        this.renderLogs();
      });
      
      this.panel.addEventListener('click', (e) => {
        if (e.target === this.panel) {
          this.hide();
        }
      });
      
      this.renderLogs();
    }
    
    hide() {
      if (this.panel) {
        this.panel.remove();
        this.panel = null;
        this.isOpen = false;
      }
    }
    
    renderLogs() {
      const content = document.getElementById('logs-content');
      const count = document.getElementById('logs-count');
      
      if (this.logs.length === 0) {
        if (content) {
          content.innerHTML = '<div class="logs-empty">No logs yet. Logs will appear here when errors or events occur.</div>';
        }
        if (count) count.textContent = '0 logs';
        return;
      }
      
      const filteredLogs = this.filterLevel === 'all' 
        ? this.logs 
        : this.logs.filter(log => log.level === this.filterLevel);
      
      if (filteredLogs.length === 0) {
        if (content) {
          content.innerHTML = `<div class="logs-empty">No ${this.filterLevel} logs found.</div>`;
        }
        if (count) count.textContent = '0 logs';
        return;
      }
      
      if (content) {
        content.innerHTML = filteredLogs.map(log => this.renderLogEntry(log)).join('');
        content.scrollTop = content.scrollHeight;
      }
      
      if (count) {
        count.textContent = `${filteredLogs.length} log${filteredLogs.length !== 1 ? 's' : ''}`;
      }
    }
    
    renderLogEntry(log) {
      const date = new Date(log.timestamp);
      const timeStr = date.toLocaleString();
      const div = document.createElement('div');
      div.textContent = log.message;
      const escapedMessage = div.innerHTML;
      
      let stackHtml = '';
      if (log.stack) {
        const stackDiv = document.createElement('div');
        stackDiv.textContent = log.stack;
        stackHtml = `<div class="log-details"><pre>${stackDiv.innerHTML}</pre></div>`;
      }
      
      let detailsHtml = '';
      if (log.details) {
        try {
          // Safely stringify details, handling circular references
          const safeStringify = (obj, space = 2) => {
            const seen = new WeakSet();
            return JSON.stringify(obj, (key, value) => {
              if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                  return '[Circular]';
                }
                seen.add(value);
              }
              if (typeof value === 'function') {
                return '[Function]';
              }
              if (value === undefined) {
                return '[Undefined]';
              }
              return value;
            }, space);
          };
          
          const detailsStr = safeStringify(log.details);
          const detailsDiv = document.createElement('div');
          detailsDiv.textContent = detailsStr;
          detailsHtml = `<div class="log-details"><pre>${detailsDiv.innerHTML}</pre></div>`;
        } catch (e) {
          // If stringify fails, show a simple message
          detailsHtml = `<div class="log-details"><pre>Error details available but cannot be displayed (circular reference)</pre></div>`;
        }
      }
      
      return `
        <div class="log-entry ${log.level}">
          <div class="log-timestamp">${timeStr}</div>
          <div>
            <span class="log-level ${log.level}">${log.level}</span>
            <span class="log-message">${escapedMessage}</span>
          </div>
          ${stackHtml}
          ${detailsHtml}
        </div>
      `;
    }
    
    clearLogs() {
      this.logs = [];
      this.saveLogs();
      this.renderLogs();
    }
    
    saveLogs() {
      try {
        const logsToSave = this.logs.slice(-100);
        localStorage.setItem('app-logs', JSON.stringify(logsToSave));
      } catch (e) {
        // Ignore
      }
    }
    
    loadLogs() {
      try {
        const savedLogs = localStorage.getItem('app-logs');
        if (savedLogs) {
          this.logs = JSON.parse(savedLogs);
        }
      } catch (e) {
        this.logs = [];
      }
    }
  };
  
  async function loadApplication() {
    await loadConfig();
    
    chatUI = new modules.ChatUI();
    chatUI.initialize();
    
    settingsPanel = new modules.SettingsPanel();
    
    // Initialize logs panel
    const logsPanel = new modules.LogsPanel();
    logsPanel.initialize();
    window.logsPanel = logsPanel; // Make globally accessible for error logging
    
    // Listen for errors from main process
    window.electronAPI.onLogError((logData) => {
      logsPanel.addLog(logData.level || 'error', logData.message, logData.stack, logData.details);
    });
    
    const settingsBtn = document.getElementById('settings-button');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        settingsPanel.show();
      });
    }
    
    const logsBtn = document.getElementById('logs-button');
    if (logsBtn) {
      logsBtn.addEventListener('click', () => {
        logsPanel.show();
      });
    }
    
    // Initialize chat sidebar
    const chatsSidebar = document.getElementById('chats-sidebar');
    const chatsButton = document.getElementById('chats-button');
    const chatsCloseBtn = document.getElementById('chats-close');
    const newChatBtn = document.getElementById('new-chat-btn');
    
    if (chatsButton && chatsSidebar) {
      chatsButton.addEventListener('click', () => {
        chatsSidebar.style.display = chatsSidebar.style.display === 'none' ? 'flex' : 'none';
        document.body.classList.toggle('sidebar-open');
        if (chatsSidebar.style.display === 'flex') {
          loadChatsList();
        }
      });
    }
    
    if (chatsCloseBtn && chatsSidebar) {
      chatsCloseBtn.addEventListener('click', () => {
        chatsSidebar.style.display = 'none';
        document.body.classList.remove('sidebar-open');
      });
    }
    
    if (newChatBtn) {
      newChatBtn.addEventListener('click', () => {
        createNewChat();
      });
    }
    
    setupProviderSelector();
    
    // Listen for config updates
    window.addEventListener('config-updated', async () => {
      await loadConfig();
      setupProviderSelector();
    });
    
    window.addEventListener('chat-send-message', async (e) => {
      const content = e.detail.content;
      
      if (!currentProviderId || !config || !config.accounts) {
        chatUI.addMessage('assistant', 'Error: No AI provider configured. Please add an account in Settings.');
        return;
      }
      
      // Find provider config
      const providerConfig = config.accounts.find(acc => acc.name === currentProviderId);
      if (!providerConfig) {
        chatUI.addMessage('assistant', `Error: Provider "${currentProviderId}" not found.`);
        return;
      }
      
      // Show loading message
      chatUI.addMessage('assistant', 'Thinking...');
      const loadingIndex = chatUI.messages.length - 1;
      
      // Prepare messages array
      const messages = chatUI.messages
        .filter((msg, idx) => idx < loadingIndex) // Exclude loading message
        .map(msg => {
          // Ensure message has required fields
          if (!msg.role || !msg.content) {
            console.warn('Invalid message format:', msg);
            return null;
          }
          return {
            role: msg.role,
            content: String(msg.content || '') // Ensure content is a string
          };
        })
        .filter(msg => msg !== null); // Remove invalid messages
      
      // Validate we have at least one message
      if (messages.length === 0) {
        chatUI.messages[loadingIndex].content = 'Error: No valid messages to send';
        chatUI.rerenderMessages();
        if (window.logsPanel) {
          window.logsPanel.addLog('error', 'No valid messages to send to AI');
        }
        return;
      }
      
      try {
        // Send to AI via IPC
        let fullContent = '';
        const result = await window.electronAPI.sendAIMessageStream(
          providerConfig,
          messages,
          (chunk) => {
            fullContent += chunk;
            chatUI.updateLastAssistantMessage(fullContent);
          }
        );
        
        if (result.success) {
          // Message already updated by streaming
          if (result.content) {
            chatUI.updateLastAssistantMessage(result.content);
          }
        } else {
          const errorMsg = result.error || 'Unknown error';
          const errorDetails = result.details || {};
          
          // Build detailed error message
          let detailedError = errorMsg;
          if (errorDetails.status) {
            detailedError += ` (Status: ${errorDetails.status})`;
          }
          if (errorDetails.responseData) {
            try {
              const responseStr = typeof errorDetails.responseData === 'string' 
                ? errorDetails.responseData 
                : JSON.stringify(errorDetails.responseData, null, 2);
              detailedError += `\n\nResponse: ${responseStr}`;
            } catch (e) {
              // Ignore JSON stringify errors
            }
          }
          
          chatUI.messages[loadingIndex].content = `Error: ${errorMsg}`;
          chatUI.rerenderMessages();
          
          // Log error with full details (safely)
          if (window.logsPanel) {
            try {
              // Safely stringify error details
              const safeDetails = {
                provider: errorDetails.providerType,
                model: errorDetails.model,
                status: errorDetails.status,
                response: errorDetails.responseData
              };
              
              window.logsPanel.addLog('error', 'AI request failed: ' + errorMsg, null, safeDetails);
            } catch (e) {
              // If logging fails, just log the basic message
              window.logsPanel.addLog('error', 'AI request failed: ' + errorMsg);
            }
          }
        }
      } catch (error) {
        chatUI.messages[loadingIndex].content = `Error: ${error.message || 'Unknown error'}`;
        chatUI.rerenderMessages();
        // Log error (safely)
        if (window.logsPanel) {
          try {
            const safeError = {
              message: error.message,
              name: error.name,
              stack: error.stack
            };
            window.logsPanel.addLog('error', 'AI request error: ' + (error.message || 'Unknown error'), error.stack, safeError);
          } catch (e) {
            // If logging fails, just log the basic message
            window.logsPanel.addLog('error', 'AI request error: ' + (error.message || 'Unknown error'));
          }
        }
      }
    });
  }
  
  async function loadConfig() {
    try {
      const result = await window.electronAPI.getConfig();
      if (result.success) {
        config = result.data;
      } else {
        config = { accounts: [], settings: {} };
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      config = { accounts: [], settings: {} };
    }
  }
  
  function setupProviderSelector() {
    const selector = document.getElementById('provider-selector');
    if (!selector || !config) return;
    
    selector.innerHTML = '<option value="">No provider</option>';
    
    if (config.accounts && config.accounts.length > 0) {
      config.accounts.forEach(acc => {
        const option = document.createElement('option');
        option.value = acc.name;
        option.textContent = acc.name;
        selector.appendChild(option);
      });
      
      if (!currentProviderId && config.accounts.length > 0) {
        currentProviderId = config.accounts[0].name;
        selector.value = currentProviderId;
      } else if (currentProviderId) {
        selector.value = currentProviderId;
      }
    }
    
    // Handle selector change
    selector.addEventListener('change', (e) => {
      currentProviderId = e.target.value || null;
    });
  }
  
  async function loadConfig() {
    try {
      const result = await window.electronAPI.getConfig();
      if (result.success) {
        config = result.data;
      } else {
        config = { accounts: [], settings: {} };
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      config = { accounts: [], settings: {} };
    }
  }
  
  // Chat Management Functions
  async function loadChatsList() {
    const chatsList = document.getElementById('chats-list');
    if (!chatsList) return;
    
    try {
      const result = await window.electronAPI.listChats();
      if (result.success && result.chats) {
        if (result.chats.length === 0) {
          chatsList.innerHTML = '<div class="chats-empty">No chats yet. Create a new chat to get started!</div>';
          return;
        }
        
        chatsList.innerHTML = result.chats.map(chat => {
          const date = new Date(chat.date);
          const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const isActive = chat.id === chatUI.currentChatId;
          
          return `
            <div class="chat-item ${isActive ? 'active' : ''}" data-chat-id="${chat.id}">
              <div class="chat-item-info">
                <div class="chat-item-name">${escapeHtml(chat.name)}</div>
                <div class="chat-item-preview">${escapeHtml(chat.preview)}</div>
                <div class="chat-item-date">${dateStr}</div>
              </div>
              <div class="chat-item-actions">
                <button class="chat-delete-btn" data-chat-id="${chat.id}" title="Delete chat">🗑️</button>
              </div>
            </div>
          `;
        }).join('');
        
        // Add click handlers
        chatsList.querySelectorAll('.chat-item').forEach(item => {
          item.addEventListener('click', (e) => {
            if (!e.target.classList.contains('chat-delete-btn')) {
              const chatId = item.dataset.chatId;
              loadChat(chatId);
            }
          });
        });
        
        // Add delete handlers
        chatsList.querySelectorAll('.chat-delete-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const chatId = btn.dataset.chatId;
            if (confirm(`Are you sure you want to delete "${chatId === 'default' ? 'Default Chat' : chatId}"?`)) {
              await deleteChat(chatId);
            }
          });
        });
      } else {
        chatsList.innerHTML = '<div class="chats-empty">Failed to load chats.</div>';
      }
    } catch (error) {
      console.error('Failed to load chats list:', error);
      chatsList.innerHTML = '<div class="chats-empty">Error loading chats.</div>';
    }
  }
  
  async function createNewChat() {
    const chatId = 'chat-' + Date.now();
    chatUI.currentChatId = chatId;
    chatUI.messages = [];
    chatUI.rerenderMessages();
    
    // Hide sidebar
    const chatsSidebar = document.getElementById('chats-sidebar');
    if (chatsSidebar) {
      chatsSidebar.style.display = 'none';
      document.body.classList.remove('sidebar-open');
    }
    
    // Reload chats list
    await loadChatsList();
  }
  
  async function loadChat(chatId) {
    chatUI.currentChatId = chatId;
    await chatUI.loadChatHistory();
    
    // Hide sidebar
    const chatsSidebar = document.getElementById('chats-sidebar');
    if (chatsSidebar) {
      chatsSidebar.style.display = 'none';
      document.body.classList.remove('sidebar-open');
    }
    
    // Reload chats list to update active state
    await loadChatsList();
  }
  
  async function deleteChat(chatId) {
    try {
      const result = await window.electronAPI.deleteChat(chatId);
      if (result.success) {
        // If we deleted the current chat, switch to default
        if (chatId === chatUI.currentChatId) {
          chatUI.currentChatId = 'default';
          chatUI.messages = [];
          chatUI.rerenderMessages();
        }
        
        // Reload chats list
        await loadChatsList();
      } else {
        alert('Failed to delete chat: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to delete chat:', error);
      alert('Failed to delete chat: ' + error.message);
    }
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Chat Management Functions
  async function loadChatsList() {
    const chatsList = document.getElementById('chats-list');
    if (!chatsList) return;
    
    try {
      const result = await window.electronAPI.listChats();
      if (result.success && result.chats) {
        if (result.chats.length === 0) {
          chatsList.innerHTML = '<div class="chats-empty">No chats yet. Create a new chat to get started!</div>';
          return;
        }
        
        chatsList.innerHTML = result.chats.map(chat => {
          const date = new Date(chat.date);
          const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const isActive = chat.id === chatUI.currentChatId;
          
          return `
            <div class="chat-item ${isActive ? 'active' : ''}" data-chat-id="${chat.id}">
              <div class="chat-item-info">
                <div class="chat-item-name">${escapeHtml(chat.name)}</div>
                <div class="chat-item-preview">${escapeHtml(chat.preview)}</div>
                <div class="chat-item-date">${dateStr}</div>
              </div>
              <div class="chat-item-actions">
                <button class="chat-delete-btn" data-chat-id="${chat.id}" title="Delete chat">🗑️</button>
              </div>
            </div>
          `;
        }).join('');
        
        // Add click handlers
        chatsList.querySelectorAll('.chat-item').forEach(item => {
          item.addEventListener('click', (e) => {
            if (!e.target.classList.contains('chat-delete-btn')) {
              const chatId = item.dataset.chatId;
              loadChat(chatId);
            }
          });
        });
        
        // Add delete handlers
        chatsList.querySelectorAll('.chat-delete-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const chatId = btn.dataset.chatId;
            if (confirm(`Are you sure you want to delete "${chatId === 'default' ? 'Default Chat' : chatId}"?`)) {
              await deleteChat(chatId);
            }
          });
        });
      } else {
        chatsList.innerHTML = '<div class="chats-empty">Failed to load chats.</div>';
      }
    } catch (error) {
      console.error('Failed to load chats list:', error);
      chatsList.innerHTML = '<div class="chats-empty">Error loading chats.</div>';
    }
  }
  
  async function createNewChat() {
    const chatId = 'chat-' + Date.now();
    chatUI.currentChatId = chatId;
    chatUI.messages = [];
    chatUI.rerenderMessages();
    
    // Hide sidebar
    const chatsSidebar = document.getElementById('chats-sidebar');
    if (chatsSidebar) {
      chatsSidebar.style.display = 'none';
      document.body.classList.remove('sidebar-open');
    }
    
    // Reload chats list
    await loadChatsList();
  }
  
  async function loadChat(chatId) {
    chatUI.currentChatId = chatId;
    await chatUI.loadChatHistory();
    
    // Hide sidebar
    const chatsSidebar = document.getElementById('chats-sidebar');
    if (chatsSidebar) {
      chatsSidebar.style.display = 'none';
      document.body.classList.remove('sidebar-open');
    }
    
    // Reload chats list to update active state
    await loadChatsList();
  }
  
  async function deleteChat(chatId) {
    try {
      const result = await window.electronAPI.deleteChat(chatId);
      if (result.success) {
        // If we deleted the current chat, switch to default
        if (chatId === chatUI.currentChatId) {
          chatUI.currentChatId = 'default';
          chatUI.messages = [];
          chatUI.rerenderMessages();
        }
        
        // Reload chats list
        await loadChatsList();
      } else {
        alert('Failed to delete chat: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to delete chat:', error);
      alert('Failed to delete chat: ' + error.message);
    }
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Expose functions for settings panel
  window.loadConfig = loadConfig;
  window.setupProviderSelector = setupProviderSelector;
  window.currentProviderId = () => currentProviderId;
  window.setCurrentProviderId = (id) => { currentProviderId = id; };
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
  
})();

