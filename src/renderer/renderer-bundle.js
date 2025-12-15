/**
 * Renderer Bundle
 * Bundled renderer code for browser execution
 * In production, use webpack/rollup to properly bundle
 */

(function () {
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
      this.context = null; // Optional context/description for the chat
      this.autoSaveTimer = null;
      this.isBlurred = false;

      // Real-time listening state
      this.isRealTimeListening = false;
      this.desktopStream = null;
      this.micStream = null;
      this.mergedStream = null;
      this.audioContext = null;
      this.conversationHistory = [];
      this.activeTranscriptions = new Map(); // chunkId -> promise
      this.activeAIRequests = new Map(); // requestId -> promise
      this.transcriptionAccumulator = '';
      this.lastTranscriptionTime = null;
      this.chunkCounter = 0;
      this.realTimeMediaRecorder = null;
      this.realtimeStats = {
        chunks: 0,
        transcriptions: 0,
        aiResponses: 0
      };
    }

    initialize() {
      this.chatContainer = document.getElementById('chat-messages');
      this.inputArea = document.getElementById('message-input');
      this.sendButton = document.getElementById('send-button');

      // Real-time listening UI elements
      this.realtimePanel = document.getElementById('realtime-transcription-panel');
      this.realtimeTranscriptionEl = document.getElementById('realtime-live-transcription');
      this.realtimeAIResponseEl = document.getElementById('realtime-ai-response');

      // Stop button for real-time panel
      const realtimeStopBtn = document.getElementById('realtime-stop-btn');
      if (realtimeStopBtn) {
        realtimeStopBtn.addEventListener('click', () => {
          this.stopRealTimeListening();
        });
      }

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
      console.log('ChatUI: Setting up event listeners...');
      console.log('sendButton:', !!this.sendButton);

      if (!this.sendButton) {
        console.error('ChatUI: sendButton is null!');
        return;
      }

      // Remove any existing listeners by cloning
      const newSendBtn = this.sendButton.cloneNode(true);
      this.sendButton.parentNode.replaceChild(newSendBtn, this.sendButton);
      this.sendButton = newSendBtn;

      this.sendButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Send button clicked');
        this.sendMessage();
      });
      console.log('✅ Send button listener attached');

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

          if (window.logsPanel) {
            window.logsPanel.addLog('info', `Voice input initialized with API: ${voiceAPI}`, null, {
              source: 'VoiceInput',
              action: 'voice_input_initialized',
              api: voiceAPI,
              enabled: settings.voiceEnabled !== false
            });
          }

          // Check if voice is enabled
          if (settings.voiceEnabled === false) {
            this.listenButton.disabled = true;
            this.listenButton.title = 'Voice input is disabled in Settings';
            if (window.logsPanel) {
              window.logsPanel.addLog('warn', 'Voice input is disabled in settings', null, {
                source: 'VoiceInput',
                action: 'voice_disabled'
              });
            }
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
        if (window.logsPanel) {
          window.logsPanel.addLog('warn', `Failed to load voice settings, defaulting to Whisper: ${e.message}`, e.stack, {
            source: 'VoiceInput',
            action: 'settings_load_error'
          });
        }
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

      this.listenButton.innerHTML = '<i data-feather="mic" class="icon icon-small"></i> Listen';
      this.listenButton.title = 'Start voice input with OpenAI Whisper (CTRL+L)';
      if (typeof feather !== 'undefined') feather.replace();

      // Listen button click - check if VoiceAssistant is handling it first
      // VoiceAssistant should take priority if it's initialized
      this.listenButton.addEventListener('click', async (e) => {
        // Check if VoiceAssistant is handling the button
        // If VoiceAssistant exists and is initialized, let it handle the click
        if (window.voiceAssistant && typeof window.voiceAssistant.toggle === 'function') {
          // VoiceAssistant will handle this, but we still need to check for old system cleanup
          if (this.isRealTimeListening) {
            await this.stopRealTimeListening();
          }
          if (this.isRecording) {
            this.stopWhisperRecording();
          }
          // Don't start old system, let VoiceAssistant handle it
          return;
        }

        // Fallback to old system if VoiceAssistant not available
        if (this.isRealTimeListening) {
          await this.stopRealTimeListening();
        } else if (this.isRecording) {
          this.stopWhisperRecording();
        } else {
          // Always start real-time listening for continuous transcription and AI responses
          await this.startRealTimeListening();
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
        // Log: Starting voice recording
        if (window.logsPanel) {
          window.logsPanel.addLog('info', 'Voice recording started', null, { source: 'VoiceInput', action: 'start_recording' });
        }

        // Check if voice is enabled
        const configResult = await window.electronAPI.getConfig();
        if (configResult.success && configResult.data) {
          const settings = configResult.data.settings || {};
          if (settings.voiceEnabled === false) {
            const errorMsg = 'Voice input is disabled in Settings.';
            this.showVoiceError(errorMsg);
            if (window.logsPanel) {
              window.logsPanel.addLog('warn', 'Voice recording blocked: Voice input disabled in settings', null, { source: 'VoiceInput' });
            }
            return;
          }
        }

        // Get microphone access
        if (window.logsPanel) {
          window.logsPanel.addLog('info', 'Requesting microphone access...', null, { source: 'VoiceInput', action: 'request_microphone' });
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Create MediaRecorder
        this.mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus'
        });

        if (window.logsPanel) {
          window.logsPanel.addLog('success', 'Microphone access granted. MediaRecorder created', null, {
            source: 'VoiceInput',
            action: 'microphone_granted',
            mimeType: 'audio/webm;codecs=opus'
          });
        }

        this.audioChunks = [];
        let totalAudioSize = 0;

        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this.audioChunks.push(event.data);
            totalAudioSize += event.data.size;
            // Log audio chunks periodically (every 2 seconds)
            if (this.audioChunks.length % 2 === 0 && window.logsPanel) {
              window.logsPanel.addLog('info', `Audio chunk received (${event.data.size} bytes). Total: ${totalAudioSize} bytes`, null, {
                source: 'VoiceInput',
                action: 'audio_chunk_received',
                chunkSize: event.data.size,
                totalSize: totalAudioSize,
                chunkCount: this.audioChunks.length
              });
            }
          }
        };

        this.mediaRecorder.onstop = async () => {
          // Log: Recording stopped
          if (window.logsPanel) {
            window.logsPanel.addLog('info', '🛑 Voice recording stopped', null, {
              source: 'VoiceInput',
              action: 'stop_recording',
              chunkCount: this.audioChunks.length,
              totalSize: totalAudioSize
            });
          }

          // Stop all tracks
          stream.getTracks().forEach(track => track.stop());

          // Create blob from chunks
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          const audioSize = audioBlob.size;

          if (window.logsPanel) {
            window.logsPanel.addLog('info', `Processing audio: ${audioSize} bytes, ${this.audioChunks.length} chunks`, null, {
              source: 'VoiceInput',
              action: 'processing_audio',
              audioSize: audioSize,
              chunkCount: this.audioChunks.length
            });
          }

          // Convert to ArrayBuffer/Uint8Array for IPC (Buffer not available in renderer)
          const arrayBuffer = await audioBlob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          if (window.logsPanel) {
            window.logsPanel.addLog('info', `Audio converted to Uint8Array (${uint8Array.length} bytes)`, null, {
              source: 'VoiceInput',
              action: 'audio_converted',
              arrayLength: uint8Array.length
            });
          }

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
            const errorMsg = 'No API key found for Whisper transcription.';
            this.showVoiceError(
              errorMsg + '\n\n' +
              'Please add an OpenAI or Groq account with Whisper model in Settings → AI Accounts.\n\n' +
              'For Groq: Use whisper-large-v3 or whisper-large-v3-turbo model'
            );
            if (window.logsPanel) {
              window.logsPanel.addLog('error', 'Voice transcription failed: No API key found', null, {
                source: 'VoiceInput',
                action: 'transcription_error',
                error: 'no_api_key',
                availableAccounts: accounts.length
              });
            }
            return;
          }

          if (window.logsPanel) {
            window.logsPanel.addLog('info', `Found API account: ${apiAccount.type} (${apiAccount.name || 'Unnamed'})`, null, {
              source: 'VoiceInput',
              action: 'api_account_found',
              provider: apiAccount.type,
              accountName: apiAccount.name
            });
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

            if (window.logsPanel) {
              window.logsPanel.addLog('info', `Sending audio to ${apiAccount.type} Whisper API (model: ${whisperModel})`, null, {
                source: 'VoiceInput',
                action: 'sending_to_api',
                provider: apiAccount.type,
                model: whisperModel,
                audioSize: uint8Array.length
              });
            }

            const transcriptionStartTime = Date.now();
            const result = await window.electronAPI.transcribeAudio(
              uint8Array,
              apiAccount.apiKey,
              apiAccount.type || 'openai',
              whisperModel
            );
            const transcriptionDuration = Date.now() - transcriptionStartTime;

            if (result.success && result.text) {
              const transcribedText = result.text.trim();

              if (window.logsPanel) {
                window.logsPanel.addLog('success', `✅ Transcription successful (${transcriptionDuration}ms): "${transcribedText.substring(0, 50)}${transcribedText.length > 50 ? '...' : ''}"`, null, {
                  source: 'VoiceInput',
                  action: 'transcription_success',
                  provider: apiAccount.type,
                  model: whisperModel,
                  duration: transcriptionDuration,
                  textLength: transcribedText.length,
                  transcribedText: transcribedText
                });
              }

              // Clear status
              if (this.voiceStatusEl) {
                this.voiceStatusEl.classList.remove('active');
              }

              // Send transcribed text to AI
              if (window.logsPanel) {
                window.logsPanel.addLog('info', `Sending transcribed text to AI chat`, null, {
                  source: 'VoiceInput',
                  action: 'sending_to_chat',
                  textLength: transcribedText.length
                });
              }

              this.sendVoiceMessage(transcribedText);
            } else {
              const errorMsg = 'Transcription failed: ' + (result.error || 'Unknown error');
              this.showVoiceError(errorMsg);
              if (window.logsPanel) {
                window.logsPanel.addLog('error', `Transcription failed: ${result.error || 'Unknown error'}`, null, {
                  source: 'VoiceInput',
                  action: 'transcription_error',
                  provider: apiAccount.type,
                  model: whisperModel,
                  duration: transcriptionDuration,
                  error: result.error,
                  errorDetails: result
                });
              }
            }
          } catch (error) {
            const errorMsg = 'Failed to transcribe: ' + error.message;
            this.showVoiceError(errorMsg);
            if (window.logsPanel) {
              window.logsPanel.addLog('error', `Transcription exception: ${error.message}`, error.stack, {
                source: 'VoiceInput',
                action: 'transcription_exception',
                error: error.message,
                stack: error.stack
              });
            }
          }
        };

        // Start recording
        this.mediaRecorder.start(1000); // Collect data every second
        this.isRecording = true;

        if (window.logsPanel) {
          window.logsPanel.addLog('success', 'Recording in progress... Speak now!', null, {
            source: 'VoiceInput',
            action: 'recording_active',
            timeslice: 1000
          });
        }

        // Update UI
        this.listenButton.textContent = '🛑 Stop';
        this.listenButton.classList.add('listening');

        if (this.voiceStatusEl) {
          this.voiceStatusEl.innerHTML = `
            <div><i data-feather="mic" class="icon icon-small"></i> Recording...</div>
            <div class="voice-text" id="voice-transcript">Speak now...</div>
          `;
          if (typeof feather !== 'undefined') feather.replace();
          this.voiceStatusEl.classList.add('active');
        }

      } catch (error) {
        console.error('Failed to start recording:', error);

        let errorLog = {
          source: 'VoiceInput',
          action: 'recording_start_error',
          errorName: error.name,
          errorMessage: error.message
        };

        if (error.name === 'NotAllowedError') {
          const errorMsg = 'Microphone permission denied. Please allow microphone access.';
          this.showVoiceError(errorMsg);
          if (window.logsPanel) {
            window.logsPanel.addLog('error', 'Microphone permission denied', error.stack, errorLog);
          }
        } else if (error.name === 'NotFoundError') {
          const errorMsg = 'No microphone found. Please connect a microphone.';
          this.showVoiceError(errorMsg);
          if (window.logsPanel) {
            window.logsPanel.addLog('error', 'No microphone found', error.stack, errorLog);
          }
        } else {
          const errorMsg = 'Failed to start recording: ' + error.message;
          this.showVoiceError(errorMsg);
          if (window.logsPanel) {
            window.logsPanel.addLog('error', `Recording start failed: ${error.message}`, error.stack, errorLog);
          }
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

    async sendVoiceMessage(text) {
      if (!text || !text.trim()) {
        if (window.logsPanel) {
          window.logsPanel.addLog('warn', 'Voice message empty, not sending to AI', null, {
            source: 'VoiceInput',
            action: 'empty_message_skipped'
          });
        }
        return;
      }

      if (window.logsPanel) {
        window.logsPanel.addLog('info', `✅ Voice transcription complete: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`, null, {
          source: 'VoiceInput',
          action: 'transcription_complete',
          textLength: text.length
        });
      }

      // Log which chat provider/model will be used (NOT Whisper - Whisper is only for transcription)
      if (window.logsPanel) {
        try {
          const configResult = await window.electronAPI.getConfig();
          if (configResult.success && configResult.data) {
            const globalCurrentProviderId = window.currentProviderId || null;
            if (globalCurrentProviderId) {
              const accounts = configResult.data.accounts || [];
              const chatAccount = accounts.find(acc => acc.name === globalCurrentProviderId);
              if (chatAccount) {
                window.logsPanel.addLog('info', `🎯 Auto-sending to Chat: "${chatAccount.name}" (${chatAccount.model || 'default model'})`, null, {
                  source: 'VoiceInput',
                  action: 'auto_sending_to_chat',
                  provider: chatAccount.name,
                  providerType: chatAccount.type,
                  chatModel: chatAccount.model,
                  flow: 'Voice → Whisper (transcription) → Chat Model (auto-reply)'
                });
              } else {
                window.logsPanel.addLog('warn', `No chat provider selected. Please select one from the dropdown.`, null, {
                  source: 'VoiceInput',
                  action: 'no_chat_provider'
                });
              }
            } else {
              window.logsPanel.addLog('warn', `⚠️ No chat provider selected. Please select one from the dropdown.`, null, {
                source: 'VoiceInput',
                action: 'no_chat_provider'
              });
            }
          }
        } catch (e) {
          // Ignore errors in logging
        }
      }

      // Add user message with voice indicator
      this.addMessage('user', text);

      // Automatically trigger AI response - this uses the selected chat provider/model (NOT Whisper)
      // Whisper was only used for transcription above, now we send text to chat model for AI response
      if (window.logsPanel) {
        window.logsPanel.addLog('info', `🚀 Auto-sending transcribed text to AI chat (will get automatic reply)`, null, {
          source: 'VoiceInput',
          action: 'auto_sending_message',
          textLength: text.length
        });
      }

      // Dispatch event to trigger AI response automatically
      window.dispatchEvent(new CustomEvent('chat-send-message', {
        detail: { content: text }
      }));
    }

    // Real-time Listening Methods

    async getDesktopAudioStream() {
      try {
        // Try getDisplayMedia first (works in Electron)
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
          if (window.logsPanel) {
            window.logsPanel.addLog('info', 'Requesting desktop audio capture via getDisplayMedia...', null, {
              source: 'RealTimeListening',
              action: 'request_desktop_capture'
            });
          }

          const stream = await navigator.mediaDevices.getDisplayMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              suppressLocalAudioPlayback: false
            },
            video: true // Required even if we only want audio
          });

          // Check if stream has audio tracks
          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length > 0) {
            if (window.logsPanel) {
              window.logsPanel.addLog('success', `Desktop audio capture successful (${audioTracks.length} audio track(s))`, null, {
                source: 'RealTimeListening',
                action: 'desktop_capture_success',
                audioTracks: audioTracks.length
              });
            }
            return stream;
          } else {
            // No audio tracks, but we have the stream
            if (window.logsPanel) {
              window.logsPanel.addLog('warn', 'Desktop capture stream has no audio tracks, but continuing...', null, {
                source: 'RealTimeListening',
                action: 'no_audio_tracks'
              });
            }
            return stream; // Return anyway, might work
          }
        } else {
          throw new Error('getDisplayMedia not available');
        }
      } catch (error) {
        if (window.logsPanel) {
          window.logsPanel.addLog('error', `Failed to get desktop audio: ${error.message}`, error.stack, {
            source: 'RealTimeListening',
            action: 'desktop_capture_error',
            error: error.message
          });
        }
        throw error;
      }
    }

    mergeAudioStreams(desktopStream, micStream) {
      try {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const desktopSource = this.audioContext.createMediaStreamSource(desktopStream);
        const micSource = this.audioContext.createMediaStreamSource(micStream);
        const destination = this.audioContext.createMediaStreamDestination();

        desktopSource.connect(destination);
        micSource.connect(destination);

        if (window.logsPanel) {
          window.logsPanel.addLog('success', 'Audio streams merged successfully', null, {
            source: 'RealTimeListening',
            action: 'audio_streams_merged',
            desktopTracks: desktopStream.getAudioTracks().length,
            micTracks: micStream.getAudioTracks().length,
            mergedTracks: destination.stream.getAudioTracks().length
          });
        }

        return destination.stream;
      } catch (error) {
        if (window.logsPanel) {
          window.logsPanel.addLog('error', `Failed to merge audio streams: ${error.message}`, error.stack, {
            source: 'RealTimeListening',
            action: 'merge_error',
            error: error.message
          });
        }
        throw error;
      }
    }

    async startRealTimeListening() {
      if (this.isRealTimeListening) {
        if (window.logsPanel) {
          window.logsPanel.addLog('warn', 'Real-time listening already active', null, {
            source: 'RealTimeListening',
            action: 'already_listening'
          });
        }
        return;
      }

      try {
        if (window.logsPanel) {
          window.logsPanel.addLog('info', '🚀 Starting real-time listening...', null, {
            source: 'RealTimeListening',
            action: 'start_listening'
          });
        }

        // Check voice enabled
        const configResult = await window.electronAPI.getConfig();
        if (configResult.success && configResult.data) {
          const settings = configResult.data.settings || {};
          if (settings.voiceEnabled === false) {
            this.showVoiceError('Voice input is disabled in Settings.');
            return;
          }
        }

        // Get microphone stream
        if (window.logsPanel) {
          window.logsPanel.addLog('info', 'Requesting microphone access...', null, {
            source: 'RealTimeListening',
            action: 'request_microphone'
          });
        }
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Get desktop audio stream
        try {
          this.desktopStream = await this.getDesktopAudioStream();

          // Handle stream stop event (user can stop sharing)
          if (this.desktopStream) {
            this.desktopStream.getTracks().forEach(track => {
              track.onended = () => {
                if (window.logsPanel) {
                  window.logsPanel.addLog('warn', 'Desktop audio track ended (user stopped sharing)', null, {
                    source: 'RealTimeListening',
                    action: 'desktop_track_ended'
                  });
                }
                // Continue with mic only
                this.desktopStream = null;
                // Re-merge streams if needed
                if (this.micStream && this.isRealTimeListening) {
                  try {
                    this.mergedStream = this.micStream;
                    // Restart recording with new stream
                    if (this.realTimeMediaRecorder) {
                      this.realTimeMediaRecorder.stop();
                    }
                    this.startRealTimeChunking();
                  } catch (e) {
                    if (window.logsPanel) {
                      window.logsPanel.addLog('error', `Failed to recover from desktop track end: ${e.message}`, e.stack, {
                        source: 'RealTimeListening',
                        action: 'recovery_error'
                      });
                    }
                  }
                }
              };
            });
          }
        } catch (desktopError) {
          if (window.logsPanel) {
            window.logsPanel.addLog('warn', `Desktop capture failed, continuing with microphone only: ${desktopError.message}`, null, {
              source: 'RealTimeListening',
              action: 'desktop_capture_fallback',
              error: desktopError.message
            });
          }
          // Continue with mic only
          this.desktopStream = null;
        }

        // Merge streams if both available
        if (this.desktopStream && this.micStream) {
          this.mergedStream = this.mergeAudioStreams(this.desktopStream, this.micStream);
        } else if (this.micStream) {
          this.mergedStream = this.micStream;
        } else {
          throw new Error('No audio streams available');
        }

        // Initialize conversation state
        this.conversationHistory = [];
        this.transcriptionAccumulator = '';
        this.chunkCounter = 0;
        this.activeTranscriptions.clear();
        this.activeAIRequests.clear();
        // Reset stats
        this.realtimeStats = {
          chunks: 0,
          transcriptions: 0,
          aiResponses: 0
        };
        this.updateRealtimeStats();

        // Show status in voice status area
        if (this.voiceStatusEl) {
          this.voiceStatusEl.innerHTML = `
            <div><i data-feather="mic" class="icon icon-small"></i> Real-time Listening...</div>
            <div class="voice-text" id="voice-transcript">Listening for audio from mic and speakers...</div>
          `;
          if (typeof feather !== 'undefined') feather.replace();
          this.voiceStatusEl.classList.add('active');
        }

        // Show message in chat that real-time listening started
        this.addMessage('assistant', 'Real-time listening started. Capturing audio from microphone and speakers...');

        // Start real-time chunking
        this.startRealTimeChunking();

        this.isRealTimeListening = true;

        if (this.listenButton) {
          this.listenButton.textContent = '🛑 Stop Listening';
          this.listenButton.classList.add('listening');
        }

        // Update menu buttons if visible
        document.querySelectorAll('.menu-button').forEach(btn => {
          if (btn.textContent.includes('Listen') || btn.id?.includes('listen')) {
            btn.textContent = '🛑 Stop';
            btn.classList.add('active');
          }
        });

        if (window.logsPanel) {
          window.logsPanel.addLog('success', '✅ Real-time listening started successfully', null, {
            source: 'RealTimeListening',
            action: 'listening_started',
            hasDesktopAudio: !!this.desktopStream,
            hasMicAudio: !!this.micStream
          });
        }

      } catch (error) {
        if (window.logsPanel) {
          window.logsPanel.addLog('error', `Failed to start real-time listening: ${error.message}`, error.stack, {
            source: 'RealTimeListening',
            action: 'start_error',
            error: error.message,
            errorName: error.name
          });
        }

        let errorMsg = 'Failed to start listening: ' + error.message;
        if (error.name === 'NotAllowedError') {
          errorMsg = 'Microphone permission denied. Please allow microphone access in your browser settings.';
        } else if (error.name === 'NotFoundError') {
          errorMsg = 'No microphone found. Please connect a microphone.';
        } else if (error.name === 'NotReadableError') {
          errorMsg = 'Microphone is being used by another application. Please close other apps using the microphone.';
        }

        this.showVoiceError(errorMsg);
        await this.cleanupRealTimeListening();
      }
    }

    startRealTimeChunking() {
      if (!this.mergedStream) {
        throw new Error('No audio stream available for chunking');
      }

      // Use a recursive function to record, stop, process, and restart
      // This ensures each blob is a complete, valid WebM file
      this.recordNextChunk();

      if (window.logsPanel) {
        window.logsPanel.addLog('info', 'Real-time audio chunking started (2s intervals)', null, {
          source: 'RealTimeListening',
          action: 'chunking_started',
          interval: 2000
        });
      }
    }

    async recordNextChunk() {
      // Stop if listening was stopped
      if (!this.isRealTimeListening || !this.mergedStream) {
        if (window.logsPanel) {
          window.logsPanel.addLog('warn', 'recordNextChunk: Listening stopped or no stream', null, {
            source: 'RealTimeListening',
            action: 'record_aborted',
            isRealTimeListening: this.isRealTimeListening,
            hasStream: !!this.mergedStream
          });
        }
        return;
      }

      try {
        // Create a new MediaRecorder for each chunk to ensure complete files
        // Try preferred mimeType first, fallback to default
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          // Try alternatives
          if (MediaRecorder.isTypeSupported('audio/webm')) {
            mimeType = 'audio/webm';
          } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
            mimeType = 'audio/ogg;codecs=opus';
          } else {
            // Use default
            mimeType = '';
          }
        }

        this.realTimeMediaRecorder = new MediaRecorder(this.mergedStream, mimeType ? { mimeType } : {});

        const chunkId = `chunk-${Date.now()}-${++this.chunkCounter}`;
        let chunkBlob = null;
        let dataResolved = false;

        // Wait for data to be available with timeout
        const dataPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (!dataResolved) {
              dataResolved = true;
              reject(new Error('Timeout waiting for audio data'));
            }
          }, 3000); // 3 second timeout

          this.realTimeMediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              chunkBlob = event.data;
              if (!dataResolved) {
                dataResolved = true;
                clearTimeout(timeout);
                resolve();
              }
            }
          };

          // Also listen for stop event as backup
          this.realTimeMediaRecorder.onstop = () => {
            // If we haven't received data yet, try to resolve anyway
            if (!dataResolved && chunkBlob) {
              dataResolved = true;
              clearTimeout(timeout);
              resolve();
            } else if (!dataResolved) {
              // No data received, resolve with null
              setTimeout(() => {
                if (!dataResolved) {
                  dataResolved = true;
                  clearTimeout(timeout);
                  resolve();
                }
              }, 100);
            }
          };

          this.realTimeMediaRecorder.onerror = (event) => {
            if (!dataResolved) {
              dataResolved = true;
              clearTimeout(timeout);
              reject(new Error(event.error || 'MediaRecorder error'));
            }
          };
        });

        // Start recording
        this.realTimeMediaRecorder.start();

        // Wait for recorder to actually start (should be immediate, but just in case)
        let startWaitTime = 0;
        while (this.realTimeMediaRecorder.state === 'inactive' && startWaitTime < 500) {
          await new Promise(resolve => setTimeout(resolve, 50));
          startWaitTime += 50;
        }

        if (this.realTimeMediaRecorder.state !== 'recording') {
          throw new Error(`MediaRecorder failed to start. State: ${this.realTimeMediaRecorder.state}`);
        }

        // Record for 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Request data before stopping to ensure we get the chunk
        if (this.realTimeMediaRecorder && this.realTimeMediaRecorder.state === 'recording') {
          this.realTimeMediaRecorder.requestData();
          // Small delay to let requestData process
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Stop the recorder
        if (this.realTimeMediaRecorder && this.realTimeMediaRecorder.state !== 'inactive') {
          this.realTimeMediaRecorder.stop();
        }

        // Wait for the data to be available (with timeout)
        try {
          await dataPromise;
        } catch (error) {
          if (window.logsPanel) {
            window.logsPanel.addLog('warn', `Timeout or error waiting for chunk data: ${error.message}`, null, {
              source: 'RealTimeListening',
              action: 'chunk_timeout',
              chunkId: chunkId,
              error: error.message
            });
          }
          // Continue to next chunk even if this one failed
        }

        // Process the chunk if we got valid data
        if (chunkBlob && chunkBlob.size > 0 && this.isRealTimeListening) {
          if (!this.realtimeStats) {
            this.realtimeStats = { chunks: 0, transcriptions: 0, aiResponses: 0 };
          }
          this.realtimeStats.chunks++;
          this.updateRealtimeStats();

          if (window.logsPanel) {
            window.logsPanel.addLog('info', `Audio chunk received (${chunkBlob.size} bytes, ID: ${chunkId})`, null, {
              source: 'RealTimeListening',
              action: 'chunk_received',
              chunkId: chunkId,
              chunkSize: chunkBlob.size,
              chunkNumber: this.chunkCounter
            });
          }

          // Process chunk asynchronously (don't await to allow next recording to start)
          this.processAudioChunk(chunkBlob, chunkId).catch(error => {
            if (window.logsPanel) {
              window.logsPanel.addLog('error', `Error processing chunk ${chunkId}: ${error.message}`, error.stack, {
                source: 'RealTimeListening',
                action: 'chunk_process_error',
                chunkId: chunkId,
                error: error.message
              });
            }
          });
        } else if (this.isRealTimeListening) {
          // No data received, but continue recording
          if (window.logsPanel) {
            window.logsPanel.addLog('warn', `No audio data received for chunk ${chunkId}`, null, {
              source: 'RealTimeListening',
              action: 'chunk_empty',
              chunkId: chunkId
            });
          }
        }
      } catch (error) {
        if (window.logsPanel) {
          window.logsPanel.addLog('error', `Error in recordNextChunk: ${error.message}`, error.stack, {
            source: 'RealTimeListening',
            action: 'record_error',
            error: error.message
          });
        }
      } finally {
        // Clean up the recorder
        if (this.realTimeMediaRecorder) {
          try {
            if (this.realTimeMediaRecorder.state !== 'inactive') {
              this.realTimeMediaRecorder.stop();
            }
          } catch (e) {
            // Ignore cleanup errors
          }
          this.realTimeMediaRecorder = null;
        }

        // Schedule next chunk recording
        if (this.isRealTimeListening) {
          // Small delay before next recording to avoid overlap
          setTimeout(() => {
            this.recordNextChunk();
          }, 100);
        }
      }
    }

    async processAudioChunk(audioBlob, chunkId) {
      try {
        // Limit concurrent transcriptions (max 3)
        if (this.activeTranscriptions.size >= 3) {
          if (window.logsPanel) {
            window.logsPanel.addLog('warn', `Too many active transcriptions, skipping chunk ${chunkId}`, null, {
              source: 'RealTimeListening',
              action: 'chunk_skipped',
              chunkId: chunkId,
              activeCount: this.activeTranscriptions.size
            });
          }
          return;
        }

        // Convert blob to Uint8Array
        const arrayBuffer = await audioBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Get API account
        const configResult = await window.electronAPI.getConfig();
        if (!configResult.success || !configResult.data) {
          throw new Error('Failed to load configuration');
        }

        const accounts = configResult.data.accounts || [];
        const settings = configResult.data.settings || {};
        const preferredVoiceAPI = settings.voiceAPI || 'groq-whisper';

        let apiAccount = accounts.find(acc => {
          if (preferredVoiceAPI === 'openai-whisper' && acc.type === 'openai' && acc.apiKey && acc.apiKey.trim() !== '') {
            return true;
          }
          if (preferredVoiceAPI === 'groq-whisper' && acc.type === 'groq' && acc.apiKey && acc.apiKey.trim() !== '') {
            return true;
          }
          if (acc.type === 'openai' && acc.apiKey && acc.apiKey.trim() !== '') return true;
          if (acc.type === 'groq' && acc.apiKey && acc.apiKey.trim() !== '') return true;
          return false;
        });

        if (!apiAccount || !apiAccount.apiKey) {
          throw new Error('No API key found for transcription');
        }

        // Get Whisper model
        let whisperModel = settings.whisperModel;
        if (!whisperModel) {
          if (apiAccount.type === 'groq') {
            whisperModel = 'whisper-large-v3-turbo';
          } else {
            whisperModel = 'whisper-1';
          }
        }

        // Create transcription promise
        const transcriptionPromise = window.electronAPI.transcribeAudio(
          uint8Array,
          apiAccount.apiKey,
          apiAccount.type || 'openai',
          whisperModel
        );

        this.activeTranscriptions.set(chunkId, transcriptionPromise);

        const result = await transcriptionPromise;

        this.activeTranscriptions.delete(chunkId);

        if (result.success && result.text) {
          const transcriptionText = result.text.trim();

          if (transcriptionText && transcriptionText.length > 0) {
            if (window.logsPanel) {
              window.logsPanel.addLog('success', `✅ Transcription (${chunkId}): "${transcriptionText.substring(0, 50)}..."`, null, {
                source: 'RealTimeListening',
                action: 'transcription_success',
                chunkId: chunkId,
                textLength: transcriptionText.length,
                preview: transcriptionText.substring(0, 50)
              });
            }

            // Update transcription accumulator
            this.transcriptionAccumulator += (this.transcriptionAccumulator ? ' ' : '') + transcriptionText;
            this.lastTranscriptionTime = Date.now();
            if (!this.realtimeStats) {
              this.realtimeStats = { chunks: 0, transcriptions: 0, aiResponses: 0 };
            }
            this.realtimeStats.transcriptions++;
            this.updateRealtimeStats();

            // Display live transcription preview
            this.updateLiveTranscription(this.transcriptionAccumulator);

            // Send to AI immediately
            await this.processTranscriptionChunk(transcriptionText, chunkId);
          }
        } else {
          // Handle transcription failure
          const errorMsg = result.error || 'Unknown error';
          if (window.logsPanel) {
            window.logsPanel.addLog('warn', `Transcription failed for chunk ${chunkId}: ${errorMsg}`, null, {
              source: 'RealTimeListening',
              action: 'transcription_failed',
              chunkId: chunkId,
              error: errorMsg
            });
          }

          // If it's a network error, log but continue (don't stop listening)
          if (errorMsg.includes('network') || errorMsg.includes('timeout')) {
            // Network errors are recoverable, continue listening
            if (this.realtimeTranscriptionEl) {
              const currentText = this.realtimeTranscriptionEl.textContent;
              if (!currentText.includes('Network error')) {
                this.realtimeTranscriptionEl.textContent = currentText + '\n[Network error - retrying...]';
              }
            }
          }
        }
      } catch (error) {
        this.activeTranscriptions.delete(chunkId);

        // Determine if error is recoverable
        const isRecoverable = error.message.includes('network') ||
          error.message.includes('timeout') ||
          error.message.includes('ECONNRESET') ||
          error.message.includes('ETIMEDOUT');

        if (window.logsPanel) {
          window.logsPanel.addLog(
            isRecoverable ? 'warn' : 'error',
            `Error processing audio chunk (${chunkId}): ${error.message}`,
            error.stack,
            {
              source: 'RealTimeListening',
              action: 'chunk_error',
              chunkId: chunkId,
              error: error.message,
              errorName: error.name,
              isRecoverable: isRecoverable
            }
          );
        }

        // For recoverable errors, don't stop listening
        if (!isRecoverable && !this.isRealTimeListening) {
          // Non-recoverable error and listening stopped, show error
          if (this.realtimeTranscriptionEl) {
            this.realtimeTranscriptionEl.textContent = `Error: ${error.message}. Listening stopped.`;
          }
        }
      }
    }

    updateLiveTranscription(text) {
      // Update voice status display with live transcription preview
      if (this.voiceStatusEl) {
        const transcriptEl = this.voiceStatusEl.querySelector('#voice-transcript') ||
          this.voiceStatusEl.querySelector('.voice-text');
        if (transcriptEl) {
          // Show preview of what's being transcribed (last 100 chars)
          const preview = text && text.length > 100
            ? '...' + text.substring(text.length - 100)
            : text || 'Listening...';
          transcriptEl.textContent = preview;
        }
        this.voiceStatusEl.classList.add('active');
      }
    }

    updateRealtimeStats() {
      if (!this.realtimeStats) {
        this.realtimeStats = { chunks: 0, transcriptions: 0, aiResponses: 0 };
      }
      const chunkCountEl = document.getElementById('realtime-chunk-count');
      const transcriptionCountEl = document.getElementById('realtime-transcription-count');
      const aiCountEl = document.getElementById('realtime-ai-count');

      if (chunkCountEl) chunkCountEl.textContent = this.realtimeStats.chunks;
      if (transcriptionCountEl) transcriptionCountEl.textContent = this.realtimeStats.transcriptions;
      if (aiCountEl) aiCountEl.textContent = this.realtimeStats.aiResponses;
    }

    async processTranscriptionChunk(transcriptionText, chunkId) {
      if (!transcriptionText || !transcriptionText.trim()) {
        return;
      }

      try {
        // Display transcribed text as user message in chat (left side)
        this.addMessage('user', transcriptionText);

        // Add to conversation history as user message
        const userMessage = {
          role: 'user',
          content: transcriptionText,
          timestamp: Date.now(),
          chunkId: chunkId
        };

        this.conversationHistory.push(userMessage);

        // Limit conversation history (keep last 20 messages)
        if (this.conversationHistory.length > 20) {
          this.conversationHistory = this.conversationHistory.slice(-20);
        }

        // Check for AI provider - need to get config
        const configResult = await window.electronAPI.getConfig();
        if (!configResult.success || !configResult.data) {
          if (window.logsPanel) {
            window.logsPanel.addLog('warn', 'Failed to load config for real-time responses', null, {
              source: 'RealTimeListening',
              action: 'config_load_error'
            });
          }
          return;
        }

        const currentConfig = configResult.data;
        if (!window.currentProviderId || !currentConfig || !currentConfig.accounts) {
          if (window.logsPanel) {
            window.logsPanel.addLog('warn', 'No AI provider configured for real-time responses', null, {
              source: 'RealTimeListening',
              action: 'no_provider'
            });
          }
          return;
        }

        const providerConfig = currentConfig.accounts.find(acc => acc.name === window.currentProviderId);
        if (!providerConfig) {
          return;
        }

        // Cancel previous AI request if new chunk arrives (for real-time, we want latest)
        if (this.activeAIRequests.size > 0) {
          // For now, we'll queue requests instead of canceling
          // Could implement cancellation if needed
        }

        // Prepare messages for AI
        const messages = this.conversationHistory.map(msg => ({
          role: msg.role,
          content: String(msg.content || '')
        }));

        // Create AI request
        const requestId = `ai-${Date.now()}-${chunkId}`;
        const aiRequestPromise = (async () => {
          // Add thinking indicator
          this.addMessage('assistant', '🤔 Thinking...');

          const loadingIndex = this.messages.length - 1;
          let fullContent = '';

          try {
            const result = await window.electronAPI.sendAIMessageStream(
              providerConfig,
              messages,
              (chunk) => {
                fullContent += chunk;
                // Update streaming message
                if (this.messages[loadingIndex]) {
                  this.messages[loadingIndex].content = fullContent;
                  this.updateLastAssistantMessage(fullContent);
                }
              }
            );

            if (result.success && result.content) {
              // Message already updated by streaming
              if (window.logsPanel) {
                window.logsPanel.addLog('success', `✅ AI response for chunk ${chunkId}`, null, {
                  source: 'RealTimeListening',
                  action: 'ai_response_success',
                  chunkId: chunkId,
                  responseLength: result.content.length
                });
              }

              // Add to conversation history
              this.conversationHistory.push({
                role: 'assistant',
                content: result.content,
                timestamp: Date.now(),
                requestId: requestId
              });

              // Update stats
              if (!this.realtimeStats) {
                this.realtimeStats = { chunks: 0, transcriptions: 0, aiResponses: 0 };
              }
              this.realtimeStats.aiResponses++;
              this.updateRealtimeStats();

              // Final update to ensure message is correct
              if (this.messages[loadingIndex] && this.messages[loadingIndex].content !== result.content) {
                this.messages[loadingIndex].content = result.content;
                this.updateLastAssistantMessage(result.content);
              }
            } else {
              // Error response
              const errorMsg = result.error || 'Unknown error';
              if (this.messages[loadingIndex]) {
                this.messages[loadingIndex].content = `Error: ${errorMsg}`;
                this.rerenderMessages();
              }
            }
          } catch (error) {
            if (this.messages[loadingIndex]) {
              const errorMsg = error.message || 'Unknown error';
              this.messages[loadingIndex].content = `Error: ${errorMsg}`;
              this.rerenderMessages();
            }


            if (window.logsPanel) {
              window.logsPanel.addLog('error', `AI request failed for chunk ${chunkId}: ${error.message}`, error.stack, {
                source: 'RealTimeListening',
                action: 'ai_request_error',
                chunkId: chunkId,
                error: error.message
              });
            }

            // Don't throw - continue listening even if AI request fails
            // throw error;
          }
        })();

        this.activeAIRequests.set(requestId, aiRequestPromise);

        // Clean up when done
        aiRequestPromise.finally(() => {
          this.activeAIRequests.delete(requestId);
        });

      } catch (error) {
        if (window.logsPanel) {
          window.logsPanel.addLog('error', `Error processing transcription chunk: ${error.message}`, error.stack, {
            source: 'RealTimeListening',
            action: 'process_chunk_error',
            chunkId: chunkId,
            error: error.message,
            errorName: error.name
          });
        }

        // Show error in UI but continue listening
        if (this.realtimeAIResponseEl) {
          const currentText = this.realtimeAIResponseEl.textContent;
          const errorText = `[Processing error: ${error.message}]`;
          if (!currentText.includes(errorText)) {
            this.realtimeAIResponseEl.textContent = (currentText || '') + '\n' + errorText;
          }
        }
      }
    }

    async stopRealTimeListening() {
      if (!this.isRealTimeListening) {
        return;
      }

      if (window.logsPanel) {
        window.logsPanel.addLog('info', '🛑 Stopping real-time listening...', null, {
          source: 'RealTimeListening',
          action: 'stop_listening'
        });
      }

      this.isRealTimeListening = false;

      // Stop MediaRecorder
      if (this.realTimeMediaRecorder && this.realTimeMediaRecorder.state !== 'inactive') {
        this.realTimeMediaRecorder.stop();
      }

      // Wait for pending transcriptions (with timeout)
      const maxWaitTime = 5000;
      const startWait = Date.now();
      while (this.activeTranscriptions.size > 0 && (Date.now() - startWait) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Wait for pending AI requests (with timeout)
      const aiStartWait = Date.now();
      while (this.activeAIRequests.size > 0 && (Date.now() - aiStartWait) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      await this.cleanupRealTimeListening();

      // Hide real-time panel
      if (this.realtimePanel) {
        this.realtimePanel.classList.remove('active');
      }

      if (this.listenButton) {
        this.listenButton.textContent = '🎤 Listen';
        this.listenButton.classList.remove('listening');
      }

      // Update menu buttons
      document.querySelectorAll('.menu-button').forEach(btn => {
        if (btn.textContent.includes('Stop') || btn.id?.includes('listen')) {
          btn.textContent = 'Listen';
          btn.classList.remove('active');
        }
      });

      // Show message in chat that listening stopped
      this.addMessage('assistant', '🛑 Real-time listening stopped.');

      if (window.logsPanel) {
        const stats = this.realtimeStats || { chunks: 0, transcriptions: 0, aiResponses: 0 };
        window.logsPanel.addLog('success', '✅ Real-time listening stopped', null, {
          source: 'RealTimeListening',
          action: 'listening_stopped',
          stats: stats
        });
      }
    }

    async cleanupRealTimeListening() {
      try {
        // Stop all audio tracks
        if (this.desktopStream) {
          try {
            this.desktopStream.getTracks().forEach(track => {
              try {
                track.stop();
              } catch (e) {
                // Track already stopped
              }
            });
          } catch (e) {
            // Ignore errors stopping tracks
          }
          this.desktopStream = null;
        }

        if (this.micStream) {
          try {
            this.micStream.getTracks().forEach(track => {
              try {
                track.stop();
              } catch (e) {
                // Track already stopped
              }
            });
          } catch (e) {
            // Ignore errors stopping tracks
          }
          this.micStream = null;
        }

        this.mergedStream = null;

        // Close audio context
        if (this.audioContext) {
          try {
            if (this.audioContext.state !== 'closed') {
              await this.audioContext.close();
            }
          } catch (e) {
            // Context already closed or error closing
            if (window.logsPanel) {
              window.logsPanel.addLog('warn', `Error closing audio context: ${e.message}`, null, {
                source: 'RealTimeListening',
                action: 'audio_context_close_error'
              });
            }
          }
          this.audioContext = null;
        }

        // Clear MediaRecorder
        if (this.realTimeMediaRecorder) {
          try {
            if (this.realTimeMediaRecorder.state !== 'inactive') {
              this.realTimeMediaRecorder.stop();
            }
          } catch (e) {
            // Already stopped
          }
          this.realTimeMediaRecorder = null;
        }

        // Clear state
        this.transcriptionAccumulator = '';
        this.lastTranscriptionTime = null;

        // Clear active requests (they'll finish on their own or timeout)
        // Just clear the maps
        this.activeTranscriptions.clear();
        // Note: Don't clear activeAIRequests here, let them finish naturally

        // Clear UI
        if (this.voiceStatusEl) {
          this.voiceStatusEl.classList.remove('active');
        }

        if (window.logsPanel) {
          window.logsPanel.addLog('info', 'Real-time listening cleanup completed', null, {
            source: 'RealTimeListening',
            action: 'cleanup_complete'
          });
        }
      } catch (error) {
        if (window.logsPanel) {
          window.logsPanel.addLog('error', `Error during cleanup: ${error.message}`, error.stack, {
            source: 'RealTimeListening',
            action: 'cleanup_error',
            error: error.message
          });
        }
      }
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
              <div style="color: #4caf50;"><i data-feather="check" class="icon icon-small"></i> Switched to ${hasGroq ? 'Groq' : 'OpenAI'} Whisper API</div>
              <div class="voice-text" style="color: #999; font-size: 12px;">Click Listen button to try again</div>
            `;
            if (typeof feather !== 'undefined') feather.replace();
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
          <div style="color: #ff6b6b;"><i data-feather="alert-circle" class="icon icon-small"></i> Error</div>
          <div style="color: #ff6b6b; font-size: 12px; margin-top: 8px; white-space: pre-line;">${message}</div>
        `;
        if (typeof feather !== 'undefined') feather.replace();
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

      // Enhance code blocks for assistant messages (and user messages if they contain code)
      const preElements = contentDiv.querySelectorAll('pre');
      if (preElements.length > 0) {
        preElements.forEach(pre => {
          // Avoid double wrapping
          if (pre.parentNode.classList.contains('code-block-wrapper')) return;

          const code = pre.querySelector('code');
          let lang = 'text';
          if (code) {
            const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
            if (langClass) lang = langClass.replace('language-', '');
          }

          // Create wrapper structure
          const wrapper = document.createElement('div');
          wrapper.className = 'code-block-wrapper';

          const header = document.createElement('div');
          header.className = 'code-header';
          header.innerHTML = `
            <span class="code-lang">${lang}</span>
            <button class="copy-btn">Copy</button>
          `;

          // Insert wrapper before pre
          if (pre.parentNode) {
            pre.parentNode.insertBefore(wrapper, pre);
            // Move pre into wrapper
            wrapper.appendChild(header);
            wrapper.appendChild(pre);

            // Add copy event listener
            const copyBtn = header.querySelector('.copy-btn');
            copyBtn.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const textToCopy = code ? code.innerText : pre.innerText;

              try {
                await navigator.clipboard.writeText(textToCopy);
                const originalText = 'Copy';
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');

                setTimeout(() => {
                  copyBtn.textContent = originalText;
                  copyBtn.classList.remove('copied');
                }, 2000);
              } catch (err) {
                console.error('Failed to copy code:', err);
                copyBtn.textContent = 'Error';
              }
            });
          }
        });
      }

      const timestampDiv = document.createElement('div');
      timestampDiv.className = 'message-timestamp';
      const date = new Date(message.timestamp);
      timestampDiv.textContent = date.toLocaleTimeString();

      messageDiv.appendChild(contentDiv);
      messageDiv.appendChild(timestampDiv);

      this.chatContainer.appendChild(messageDiv);
    }

    rerenderMessages() {
      if (!this.chatContainer) return;
      this.chatContainer.innerHTML = '';

      // Safety check - ensure messages is an array
      if (!Array.isArray(this.messages)) {
        console.warn('Messages is not an array in rerenderMessages, resetting');
        this.messages = [];
        return;
      }

      this.messages.forEach(msg => {
        if (msg && typeof msg === 'object' && msg.role && msg.content) {
          this.renderMessage(msg);
        }
      });
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
          // Handle both old format (array of messages) and new format (object with messages and context)
          if (Array.isArray(result.data)) {
            // Old format - just an array of messages
            this.messages = Array.isArray(result.data) ? result.data : [];
            this.context = null;
          } else if (result.data && typeof result.data === 'object') {
            // New format - object with messages and context
            this.messages = Array.isArray(result.data.messages) ? result.data.messages : [];
            this.context = result.data.context || null;
          } else {
            // Invalid data format - reset to empty
            console.warn('Invalid chat data format, resetting to empty chat');
            this.messages = [];
            this.context = null;
          }

          // Final safety check - ensure messages is always an array
          if (!Array.isArray(this.messages)) {
            console.warn('Messages is not an array, resetting to empty array');
            this.messages = [];
          }

          // Validate each message has required fields
          this.messages = this.messages.filter(msg => {
            if (!msg || typeof msg !== 'object') return false;
            if (!msg.role || !msg.content) return false;
            return true;
          });

          this.rerenderMessages();
          this.autoScroll();
        } else {
          // No data or failed to load - start with empty chat
          this.messages = [];
          this.context = null;
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
        // Reset to empty chat on error
        this.messages = [];
        this.context = null;
        if (window.logsPanel) {
          window.logsPanel.addLog('error', 'Failed to load chat history: ' + error.message, error.stack);
        }
      }
    }

    async saveChatHistory() {
      try {
        // Save with context if available
        const chatData = {
          messages: this.messages,
          context: this.context || null
        };
        await window.electronAPI.saveChat(this.currentChatId, chatData);
      } catch (error) {
        console.error('Failed to save chat history:', error);
        if (window.logsPanel) {
          window.logsPanel.addLog('error', 'Failed to save chat history: ' + error.message, error.stack);
        }
      }
    }

    /**
     * Set chat context/description
     * @param {string} context - Context text
     */
    setContext(context) {
      this.context = context || null;
      this.scheduleAutoSave();
    }

    /**
     * Get chat context
     * @returns {string|null} Context text
     */
    getContext() {
      return this.context;
    }

    /**
     * Switch to a different chat
     * @param {string} chatId - Chat ID
     * @param {string|null} context - Optional context
     */
    async switchChat(chatId, context = null) {
      this.currentChatId = chatId;

      // Try to load existing chat
      try {
        await this.loadChatHistory();
      } catch (error) {
        // Chat might not exist yet, that's fine
        console.log('Chat load failed (likely new):', error);
        this.messages = [];
        this.context = null;
      }

      // If context is explicitly provided (e.g. New Chat), override whatever was loaded
      if (context !== null) {
        this.context = context;
        // Save immediately to ensure file exists and context is persisted
        await this.saveChatHistory();
      }

      this.rerenderMessages();

      // Update the sidebar list to show the new/active chat
      if (typeof loadChatsList === 'function') {
        loadChatsList();
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

      const passwordInput = document.getElementById('password-input');
      if (passwordInput) {
        passwordInput.value = '';
      }
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

          // Sync settings with main process
          if (this.config.settings) {
            if (this.config.settings.ghostWpm) {
              window.electronAPI.updateGhostWpm(this.config.settings.ghostWpm);
            }
            if (this.config.settings.ghostMistakeChance !== undefined) {
              window.electronAPI.updateGhostMistakeChance(this.config.settings.ghostMistakeChance);
            }
            if (this.config.settings.ghostMaxMistakes !== undefined) {
              window.electronAPI.updateGhostMaxMistakes(this.config.settings.ghostMaxMistakes);
            }
          }
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
              <button id="settings-close" class="settings-close-btn">
                <i data-feather="x" class="icon"></i>
              </button>
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
          <div class="setting-item" style="margin-bottom: 16px;">
            <label>
              Message retention (days, 0 = never delete):
              <input type="number" id="message-retention" value="${settings.messageRetentionDays || 0}" min="0" style="margin-left: 8px; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 6px; border-radius: 4px; width: 60px;" />
            </label>
          </div>
        </div>

        <div class="settings-section">
          <h3>Shortcuts</h3>
          <div class="setting-item" style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px;">
              Hide/Show App Shortcut:
            </label>
             <input type="text" id="hide-shortcut" value="${settings.hideShortcut || 'Ctrl+Alt+H'}" placeholder="e.g. Ctrl+Alt+H" style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 8px; border-radius: 6px;" />
          </div>
          <div class="setting-item" style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px;">
              Ghost Type Shortcut (Simulate Human Typing):
            </label>
             <input type="text" id="ghost-shortcut" value="${settings.ghostShortcut || 'Ctrl+Alt+V'}" placeholder="e.g. Ctrl+Alt+V" style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 8px; border-radius: 6px;" />
          </div>
          <div class="setting-item" style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px;">
              Quit App Shortcut:
            </label>
             <input type="text" id="quit-shortcut" value="${settings.quitShortcut || 'Ctrl+Alt+Q'}" placeholder="e.g. Ctrl+Alt+Q" style="width: 100%; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 8px; border-radius: 6px;" />
          </div>
          <div class="setting-item" style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px;">
             <label style="display: block; margin-bottom: 5px;">Typing Speed (WPM):</label>
             <div style="display: flex; align-items: center; gap: 10px;">
               <input type="number" id="ghost-wpm" value="${settings.ghostWpm || 60}" min="10" max="200" style="width: 80px; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 6px; border-radius: 6px;" />
               <small style="color: #888;">(Higher is faster)</small>
             </div>
          </div>
          <div class="setting-item" style="margin-bottom: 16px;">
             <label style="display: block; margin-bottom: 5px;">Mistake Chance (%):</label>
             <div style="display: flex; align-items: center; gap: 10px;">
               <input type="number" id="ghost-mistake-chance" value="${settings.ghostMistakeChance !== undefined ? settings.ghostMistakeChance : 5}" min="0" max="100" style="width: 80px; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 6px; border-radius: 6px;" />
               <small style="color: #888;">(0 = Perfect typing)</small>
             </div>
          </div>
          <div class="setting-item" style="margin-bottom: 16px;">
             <label style="display: block; margin-bottom: 5px;">Max Consecutive Mistakes:</label>
             <div style="display: flex; align-items: center; gap: 10px;">
               <input type="number" id="ghost-max-mistakes" value="${settings.ghostMaxMistakes || 1}" min="1" max="5" style="width: 80px; background: #252525; border: 1px solid #444; color: #e0e0e0; padding: 6px; border-radius: 6px;" />
               <small style="color: #888;">(Max wrong chars at once)</small>
             </div>
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
            { value: 'gemma2-27b-it', label: 'Gemma 2 27B IT' }
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

      // Prevent Whisper models from being saved as chat models
      const whisperModels = ['whisper-large-v3', 'whisper-large-v3-turbo', 'whisper-1'];
      if (whisperModels.includes(modelValue)) {
        alert(
          'Error: Whisper models are for audio transcription only, not chat!\n\n' +
          'For Chat Models:\n' +
          '   • Groq: Use "llama-3.1-8b-instant" or "llama-3.3-70b-versatile"\n' +
          '   • OpenAI: Use "gpt-4" or "gpt-3.5-turbo"\n\n' +
          'For Voice Input:\n' +
          '   • Whisper models are selected in Settings → Privacy → Voice Input\n' +
          '   • They transcribe your voice → then send text to your chat model\n\n' +
          'How it works:\n' +
          '   1. Voice → Whisper (transcription)\n' +
          '   2. Text → Chat Model (AI response)'
        );
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

      const retInput = document.getElementById('message-retention');
      if (retInput) {
        this.config.settings.messageRetentionDays = parseInt(retInput.value) || 0;
      }

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

      const quitShortcutInput = document.getElementById('quit-shortcut');
      if (quitShortcutInput) {
        const newQuitShortcut = quitShortcutInput.value.trim();
        if (newQuitShortcut && this.config.settings.quitShortcut !== newQuitShortcut) {
          this.config.settings.quitShortcut = newQuitShortcut;
          await window.electronAPI.updateQuitShortcut(newQuitShortcut);
        }
      }

      const ghostWpmInput = document.getElementById('ghost-wpm');
      if (ghostWpmInput) {
        const newGhostWpm = parseInt(ghostWpmInput.value) || 60;
        if (newGhostWpm && this.config.settings.ghostWpm !== newGhostWpm) {
          this.config.settings.ghostWpm = newGhostWpm;
          await window.electronAPI.updateGhostWpm(newGhostWpm);
        }
      }

      const mistakeChanceInput = document.getElementById('ghost-mistake-chance');
      if (mistakeChanceInput) {
        const newChance = parseInt(mistakeChanceInput.value);
        if (!isNaN(newChance) && this.config.settings.ghostMistakeChance !== newChance) {
          this.config.settings.ghostMistakeChance = newChance;
          await window.electronAPI.updateGhostMistakeChance(newChance);
        }
      }

      const maxMistakesInput = document.getElementById('ghost-max-mistakes');
      if (maxMistakesInput) {
        const newMax = parseInt(maxMistakesInput.value);
        if (newMax && this.config.settings.ghostMaxMistakes !== newMax) {
          this.config.settings.ghostMaxMistakes = newMax;
          await window.electronAPI.updateGhostMaxMistakes(newMax);
        }
      }

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
                <button id="logs-copy" class="logs-copy-btn">
                  <i data-feather="copy" class="icon icon-small"></i> Copy Logs
                </button>
                <button id="logs-clear" class="logs-clear-btn">Clear Logs</button>
                <button id="logs-close" class="logs-close-btn">
                  <i data-feather="x" class="icon icon-small"></i> Close
                </button>
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

      document.getElementById('logs-copy').addEventListener('click', () => {
        this.copyLogs();
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

    async copyLogs() {
      try {
        const logsText = this.logs.map(log => {
          const level = log.level.toUpperCase().padEnd(8);
          const time = new Date(log.timestamp).toLocaleString();
          let text = `[${time}] ${level} ${log.message}`;

          if (log.stack) {
            text += '\n' + log.stack;
          }

          if (log.details && typeof log.details === 'object') {
            try {
              const detailsStr = JSON.stringify(log.details, null, 2);
              text += '\n' + detailsStr;
            } catch (e) {
              text += '\n' + String(log.details);
            }
          }

          return text;
        }).join('\n\n');

        // Try to focus the window first (required for clipboard API)
        if (window.electronAPI && window.electronAPI.bringWindowToFront) {
          try {
            await window.electronAPI.bringWindowToFront();
            // Small delay to ensure focus
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (e) {
            // Ignore focus errors
          }
        }

        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(logsText);
            // Show feedback
            const copyBtn = document.getElementById('logs-copy');
            if (copyBtn) {
              const originalHTML = copyBtn.innerHTML;
              copyBtn.innerHTML = '<i data-feather="check" class="icon icon-small"></i> Copied!';
              if (typeof feather !== 'undefined') feather.replace();
              setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                if (typeof feather !== 'undefined') feather.replace();
              }, 2000);
            }
            return;
          } catch (err) {
            // Fall through to fallback method
            console.warn('Clipboard API failed, trying fallback:', err);
          }
        }

        // Fallback: Use execCommand (works even when not focused)
        const textArea = document.createElement('textarea');
        textArea.value = logsText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
          const successful = document.execCommand('copy');
          document.body.removeChild(textArea);

          if (successful) {
            // Show feedback
            const copyBtn = document.getElementById('logs-copy');
            if (copyBtn) {
              const originalHTML = copyBtn.innerHTML;
              copyBtn.innerHTML = '<i data-feather="check" class="icon icon-small"></i> Copied!';
              if (typeof feather !== 'undefined') feather.replace();
              setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                if (typeof feather !== 'undefined') feather.replace();
              }, 2000);
            }
          } else {
            throw new Error('execCommand copy failed');
          }
        } catch (err) {
          document.body.removeChild(textArea);
          throw err;
        }
      } catch (error) {
        console.error('Error copying logs:', error);
        alert('Failed to copy logs to clipboard. Please select and copy manually from the logs panel.');
      }
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
    console.log('=== renderer-bundle.js: loadApplication() called ===');

    await loadConfig();

    console.log('Creating ChatUI instance...');
    chatUI = new modules.ChatUI();
    chatUI.initialize();

    // Expose chatUI globally so it can be accessed by inline handlers
    window.chatUI = chatUI;
    console.log('✅ ChatUI initialized and exposed to window.chatUI');

    settingsPanel = new modules.SettingsPanel();

    // Initialize logs panel
    const logsPanel = new modules.LogsPanel();
    logsPanel.initialize();
    window.logsPanel = logsPanel; // Make globally accessible for error logging

    // Listen for errors from main process
    window.electronAPI.onLogError((logData) => {
      logsPanel.addLog(logData.level || 'error', logData.message, logData.stack, logData.details);
    });

    console.log('Setting up button event listeners...');

    const settingsBtn = document.getElementById('settings-button');
    console.log('settings-button found:', !!settingsBtn);
    if (settingsBtn) {
      // Remove any existing listeners by cloning
      const newBtn = settingsBtn.cloneNode(true);
      settingsBtn.parentNode.replaceChild(newBtn, settingsBtn);
      newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Settings button clicked');
        if (settingsPanel && typeof settingsPanel.show === 'function') {
          settingsPanel.show();
        } else {
          console.error('settingsPanel not available');
        }
      });
      console.log('✅ Settings button listener attached');
    } else {
      console.warn('⚠️ settings-button not found in DOM');
    }

    const logsBtn = document.getElementById('logs-button');
    console.log('logs-button found:', !!logsBtn);
    if (logsBtn) {
      // Remove any existing listeners by cloning
      const newBtn = logsBtn.cloneNode(true);
      logsBtn.parentNode.replaceChild(newBtn, logsBtn);
      newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Logs button clicked');
        if (logsPanel && typeof logsPanel.show === 'function') {
          logsPanel.show();
        } else {
          console.error('logsPanel not available');
        }
      });
      console.log('✅ Logs button listener attached');
    } else {
      console.warn('⚠️ logs-button not found in DOM');
    }

    // Initialize chat sidebar
    const chatsSidebar = document.getElementById('chats-sidebar');
    const chatsButton = document.getElementById('chats-button');
    const chatsCloseBtn = document.getElementById('chats-close');
    const newChatBtn = document.getElementById('new-chat-btn');

    console.log('chats-button found:', !!chatsButton);
    if (chatsButton && chatsSidebar) {
      // Remove any existing listeners by cloning
      const newBtn = chatsButton.cloneNode(true);
      chatsButton.parentNode.replaceChild(newBtn, chatsButton);
      newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Chats button clicked');
        chatsSidebar.style.display = chatsSidebar.style.display === 'none' ? 'flex' : 'none';
        document.body.classList.toggle('sidebar-open');
        if (chatsSidebar.style.display === 'flex') {
          loadChatsList();
        }
      });
      console.log('✅ Chats button listener attached');
    } else {
      console.warn('⚠️ chats-button or chats-sidebar not found in DOM');
    }

    if (chatsCloseBtn && chatsSidebar) {
      chatsCloseBtn.addEventListener('click', () => {
        chatsSidebar.style.display = 'none';
        document.body.classList.remove('sidebar-open');
      });
    }

    if (newChatBtn) {
      // Remove any existing listeners by cloning
      const newBtn = newChatBtn.cloneNode(true);
      newChatBtn.parentNode.replaceChild(newBtn, newChatBtn);

      newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        console.log('New chat button clicked in renderer-bundle.js');

        // Try multiple ways to show the modal
        if (typeof window.showNewChatModal === 'function') {
          console.log('Calling window.showNewChatModal');
          window.showNewChatModal();
        } else {
          console.warn('window.showNewChatModal not found, trying direct modal access');
          // Fallback: try to show modal directly
          const modal = document.getElementById('new-chat-modal');
          if (modal) {
            modal.removeAttribute('hidden');
            modal.style.display = 'flex';
            modal.style.visibility = 'visible';
            modal.style.opacity = '1';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.right = '0';
            modal.style.bottom = '0';
            modal.style.zIndex = '1001';
            modal.style.background = 'rgba(0, 0, 0, 0.8)';
            modal.style.alignItems = 'center';
            modal.style.justifyContent = 'center';
            console.log('Modal shown directly');
          } else {
            console.error('Modal element not found');
            // Last resort: use old behavior
            createNewChat();
          }
        }
        return false;
      }, true); // Capture phase
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
        if (window.logsPanel) {
          window.logsPanel.addLog('error', `Chat failed: Provider "${currentProviderId}" not found`, null, {
            source: 'Chat',
            action: 'provider_not_found',
            providerId: currentProviderId
          });
        }
        return;
      }

      // Validate that the provider doesn't have a Whisper model (should use chat models)
      const whisperModels = ['whisper-large-v3', 'whisper-large-v3-turbo', 'whisper-1'];
      if (providerConfig.model && whisperModels.includes(providerConfig.model)) {
        const errorMsg = `❌ Error: The selected provider "${providerConfig.name}" is configured with Whisper model "${providerConfig.model}"\n\n` +
          `Whisper models are for audio transcription ONLY, not chat!\n\n` +
          `🔧 Quick Fix:\n` +
          `1. Go to Settings → AI Accounts\n` +
          `2. Edit the account "${providerConfig.name}"\n` +
          `3. Change the model to a chat model:\n` +
          `   • Groq: "llama-3.1-8b-instant" (recommended - fast & affordable)\n` +
          `   • Groq: "llama-3.3-70b-versatile" (more powerful)\n` +
          `   • OpenAI: "gpt-4" or "gpt-3.5-turbo"\n\n` +
          `💡 Remember:\n` +
          `   • Chat Models = Used for AI conversations (set in AI Accounts)\n` +
          `   • Whisper Models = Used for voice transcription (set in Voice Input settings)\n\n` +
          `The provider dropdown will automatically filter out Whisper models after you fix this.`;

        chatUI.messages[loadingIndex].content = errorMsg;
        chatUI.rerenderMessages();

        if (window.logsPanel) {
          window.logsPanel.addLog('error', `❌ Chat blocked: Account "${providerConfig.name}" uses Whisper model "${providerConfig.model}"`, null, {
            source: 'Chat',
            action: 'whisper_model_blocked',
            accountName: providerConfig.name,
            model: providerConfig.model,
            providerType: providerConfig.type,
            fix: 'Edit account in Settings → AI Accounts → Change model to chat model'
          });
        }
        return;
      }

      // Show loading message
      chatUI.addMessage('assistant', 'Thinking...');
      const loadingIndex = chatUI.messages.length - 1;

      if (window.logsPanel) {
        window.logsPanel.addLog('info', `Sending message to AI: provider="${providerConfig.name}", model="${providerConfig.model || 'default'}"`, null, {
          source: 'Chat',
          action: 'sending_to_ai',
          provider: providerConfig.name,
          providerType: providerConfig.type,
          chatModel: providerConfig.model
        });
      }

      // Retrieve context if available
      const chatContext = (chatUI && typeof chatUI.getContext === 'function') ? chatUI.getContext() : null;

      // Prepare messages array
      let messages = chatUI.messages
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

      // Add system prompt with context if available
      if (chatContext) {
        if (window.logsPanel) {
          window.logsPanel.addLog('info', `Adding context to conversation: "${chatContext.substring(0, 50)}..."`);
        }

        // Check if there's already a system message
        const systemMsgIndex = messages.findIndex(m => m.role === 'system');

        if (systemMsgIndex >= 0) {
          // Append to existing system message
          messages[systemMsgIndex].content = `Context: ${chatContext}\n\n${messages[systemMsgIndex].content}`;
        } else {
          // Prepend new system message
          messages.unshift({
            role: 'system',
            content: `Context: ${chatContext}\n\nYou are a helpful AI assistant. Use the above context to inform your responses.`
          });
        }
      } else {
        // Ensure there is at least a basic system prompt if none exists
        const systemMsgIndex = messages.findIndex(m => m.role === 'system');
        if (systemMsgIndex === -1) {
          messages.unshift({
            role: 'system',
            content: 'You are a helpful AI assistant.'
          });
        }
      }

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

    // Initialize voice assistant from renderer.js after everything else is ready
    if (typeof window.initializeVoiceAssistant === 'function') {
      console.log('Calling window.initializeVoiceAssistant from renderer-bundle.js');
      try {
        await window.initializeVoiceAssistant();
      } catch (error) {
        console.error('Failed to initialize voice assistant:', error);
        if (window.logsPanel) {
          window.logsPanel.addLog('error', `Failed to initialize voice assistant: ${error.message}`, error.stack, {
            source: 'VoiceAssistant',
            action: 'initialization_failed'
          });
        }
      }
    } else {
      console.warn('window.initializeVoiceAssistant not found - voice assistant may not work');
    }
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
      // Filter out accounts with Whisper models (they can't be used for chat)
      const whisperModels = ['whisper-large-v3', 'whisper-large-v3-turbo', 'whisper-1'];
      const validAccounts = config.accounts.filter(acc => {
        if (!acc.model) return true; // No model set, allow it
        return !whisperModels.includes(acc.model);
      });

      validAccounts.forEach(acc => {
        const option = document.createElement('option');
        option.value = acc.name;
        option.textContent = acc.name + (acc.model ? ` (${acc.model})` : '');
        selector.appendChild(option);
      });

      if (!currentProviderId && validAccounts.length > 0) {
        currentProviderId = validAccounts[0].name;
        selector.value = currentProviderId;
      } else if (currentProviderId) {
        // Check if current provider is still valid
        const isValid = validAccounts.some(acc => acc.name === currentProviderId);
        if (!isValid) {
          // Current provider has Whisper model, switch to first valid one
          if (validAccounts.length > 0) {
            currentProviderId = validAccounts[0].name;
            selector.value = currentProviderId;
            if (window.logsPanel) {
              window.logsPanel.addLog('warn', `Current provider has Whisper model. Switched to "${currentProviderId}" for chat.`, null, {
                source: 'Chat',
                action: 'provider_switched_from_whisper'
              });
            }
          } else {
            currentProviderId = null;
          }
        } else {
          selector.value = currentProviderId;
        }
      }
    }

    // Handle selector change - remove old listeners first
    const newSelector = selector.cloneNode(true);
    selector.parentNode.replaceChild(newSelector, selector);
    const updatedSelector = document.getElementById('provider-selector');

    if (updatedSelector) {
      updatedSelector.addEventListener('change', (e) => {
        const selectedValue = e.target.value || null;
        const selectedOption = e.target.options[e.target.selectedIndex];

        // Prevent selecting disabled (Whisper model) accounts
        if (selectedOption && selectedOption.disabled) {
          alert('This account uses a Whisper model, which is for audio transcription only.\n\nPlease edit this account in Settings → AI Accounts and change the model to a chat model (e.g., llama-3.1-8b-instant).');
          // Reset to previous selection or first valid
          const whisperModels = ['whisper-large-v3', 'whisper-large-v3-turbo', 'whisper-1'];
          const validAccounts = config.accounts.filter(acc => {
            if (!acc.model) return true;
            return !whisperModels.includes(acc.model);
          });
          if (validAccounts.length > 0) {
            updatedSelector.value = currentProviderId || validAccounts[0].name;
          } else {
            updatedSelector.value = '';
          }
          return;
        }

        currentProviderId = selectedValue;
        window.currentProviderId = currentProviderId;

        if (window.logsPanel && currentProviderId) {
          const selectedAccount = config.accounts.find(acc => acc.name === currentProviderId);
          if (selectedAccount) {
            window.logsPanel.addLog('info', `Chat provider changed to: ${currentProviderId} (${selectedAccount.model || 'default model'})`, null, {
              source: 'Chat',
              action: 'provider_changed',
              provider: currentProviderId,
              model: selectedAccount.model
            });
          }
        }
      });
    }
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
                <button class="chat-edit-btn" data-chat-id="${chat.id}" title="Edit chat"><i data-feather="edit-2" class="icon-tiny"></i></button>
                <button class="chat-delete-btn" data-chat-id="${chat.id}" title="Delete chat"><i data-feather="trash-2" class="icon-tiny"></i></button>
              </div>
            </div>
          `;
        }).join('');

        // Render icons
        if (typeof feather !== 'undefined') {
          feather.replace();
        }

        // Add click handlers
        chatsList.querySelectorAll('.chat-item').forEach(item => {
          item.addEventListener('click', (e) => {
            // Only load if not clicking buttons
            if (!e.target.closest('.chat-item-actions')) {
              const chatId = item.dataset.chatId;
              loadChat(chatId);
            }
          });
        });

        // Add edit handlers
        chatsList.querySelectorAll('.chat-edit-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const chatId = btn.dataset.chatId;
            const chatItem = btn.closest('.chat-item');
            const nameEl = chatItem.querySelector('.chat-item-name');
            const currentName = nameEl ? nameEl.textContent : '';

            // Load the chat first to get its context
            await loadChat(chatId);

            // Now chatUI.context should be set
            if (typeof window.showNewChatModal === 'function') {
              window.showNewChatModal(chatId, currentName, chatUI.context);
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
  window.loadChatsList = loadChatsList;
  window.setupProviderSelector = setupProviderSelector;
  window.currentProviderId = currentProviderId; // Expose as property for easy access
  window.getCurrentProviderId = () => currentProviderId;
  window.setCurrentProviderId = (id) => {
    currentProviderId = id;
    window.currentProviderId = id; // Keep in sync
  };

  // Navigation Handler
  function setupNavigation() {
    // Landing page buttons
    const landingListen = document.getElementById('menu-listen');
    const landingMeeting = document.getElementById('menu-meeting');
    const landingAsk = document.getElementById('menu-ask');
    const landingScreenshot = document.getElementById('menu-screenshot');
    const landingSettings = document.getElementById('menu-settings');
    const landingQuit = document.getElementById('menu-quit');

    // Top menu buttons (in main view)
    const topListen = document.getElementById('top-menu-listen');
    const topMeeting = document.getElementById('top-menu-meeting');
    const topAsk = document.getElementById('top-menu-ask');
    const topScreenshot = document.getElementById('top-menu-screenshot');
    const topSettings = document.getElementById('top-menu-settings');
    const topQuit = document.getElementById('top-menu-quit');

    // Close view button
    const closeViewBtn = document.getElementById('close-view');

    const landingView = document.getElementById('landing-view');
    const mainView = document.getElementById('main-view');
    const askView = document.getElementById('ask-view');
    const chatView = document.getElementById('chat-view');
    const askInput = document.getElementById('ask-input');
    const askSendBtn = document.getElementById('ask-send-btn');

    function showView(viewName) {
      landingView.style.display = 'none';
      mainView.classList.add('active');

      // Hide all views
      askView.style.display = 'none';
      chatView.style.display = 'none';

      // Show selected view
      if (viewName === 'ask') {
        askView.style.display = 'flex';
        // Auto-focus input
        setTimeout(() => askInput?.focus(), 100);
      } else if (viewName === 'chat') {
        chatView.style.display = 'flex';
      }

      // Update active buttons
      document.querySelectorAll('.menu-button').forEach(btn => btn.classList.remove('active'));
      if (viewName === 'ask') {
        topAsk?.classList.add('active');
        topScreenshot?.classList.add('active');
      }
    }

    function showLanding() {
      mainView.classList.remove('active');
      landingView.style.display = 'flex';
    }

    // View switching handlers removed - using old UI
    topSettings?.addEventListener('click', () => {
      if (window.settingsPanel) {
        window.settingsPanel.show();
      }
    });
    topQuit?.addEventListener('click', () => {
      if (window.electronAPI && window.electronAPI.quitApp) {
        window.electronAPI.quitApp();
      }
    });

    // Close view button
    closeViewBtn?.addEventListener('click', () => showLanding());

    // Ask view send handler
    askSendBtn?.addEventListener('click', () => {
      const text = askInput?.value.trim();
      if (text) {
        // Switch to chat view and send message
        showView('chat');
        // Trigger chat message
        setTimeout(() => {
          const messageInput = document.getElementById('message-input');
          const sendButton = document.getElementById('send-button');
          if (messageInput) {
            messageInput.value = text;
            // Trigger send
            window.dispatchEvent(new CustomEvent('chat-send-message', {
              detail: { content: text }
            }));
          }
        }, 100);
        askInput.value = '';
      }
    });

    // Ask input Enter key handler
    askInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askSendBtn?.click();
      }
    });

    // Auto-resize textarea
    askInput?.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    });

    // Context toggle
    const contextToggle = document.getElementById('context-toggle');
    contextToggle?.addEventListener('click', function () {
      this.classList.toggle('active');
      this.textContent = this.classList.contains('active') ? 'On' : 'Off';
    });

    // Size buttons
    ['small', 'medium', 'full'].forEach(size => {
      const btn = document.getElementById(`size-${size}`);
      btn?.addEventListener('click', function () {
        document.querySelectorAll('.size-button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
      });
    });
  }

  // Browser View Handler with Tabs Support
  function setupBrowserView() {
    const browserButton = document.getElementById('browser-button');
    const browserView = document.getElementById('browser-view');
    const chatContainer = document.getElementById('chat-container');
    const browserCloseBtn = document.getElementById('browser-close-view');
    const browserUrl = document.getElementById('browser-url');
    const browserGo = document.getElementById('browser-go');
    const browserBack = document.getElementById('browser-back');
    const browserForward = document.getElementById('browser-forward');
    const browserHome = document.getElementById('browser-home');
    const browserRefresh = document.getElementById('browser-refresh');
    const browserNewTabBtn = document.getElementById('browser-new-tab');
    const browserNewIncognitoTabBtn = document.getElementById('browser-new-incognito-tab');
    const browserNewWindowBtn = document.getElementById('browser-new-window');
    const browserIncognitoBtn = document.getElementById('browser-incognito');
    const browserTabsContainer = document.getElementById('browser-tabs-container');
    const browserTabsContent = document.getElementById('browser-tabs-content');

    if (!browserView || !browserTabsContainer || !browserTabsContent) {
      // Browser elements not found, skip setup
      return;
    }

    let isBrowserOpen = false;
    let tabs = [];
    let activeTabId = null;
    let tabIdCounter = 0;

    function showBrowser() {
      // Add class to body for split view
      document.body.classList.add('browser-open');
      if (browserView) {
        browserView.classList.add('active');
      }
      isBrowserOpen = true;
      if (browserButton) {
        browserButton.innerHTML = '<i data-feather="message-circle" class="icon icon-small"></i> Chat';
        if (typeof feather !== 'undefined') feather.replace();
      }

      // Create first tab if none exist
      if (tabs.length === 0) {
        createTab('https://www.google.com', false);
      }
    }

    function hideBrowser() {
      // Remove class from body to hide browser
      document.body.classList.remove('browser-open');
      if (browserView) {
        browserView.classList.remove('active');
      }
      isBrowserOpen = false;
      if (browserButton) {
        browserButton.innerHTML = '<i data-feather="globe" class="icon icon-small"></i> Browser';
        if (typeof feather !== 'undefined') feather.replace();
      }
    }

    function createTab(url = 'https://www.google.com', incognito = false) {
      const tabId = `tab-${++tabIdCounter}`;
      const tab = {
        id: tabId,
        url: url,
        title: 'New Tab',
        incognito: incognito,
        loading: false
      };

      tabs.push(tab);

      // Create tab button
      const tabButton = document.createElement('div');
      tabButton.className = 'browser-tab' + (incognito ? ' browser-tab-incognito' : '');
      tabButton.dataset.tabId = tabId;
      tabButton.innerHTML = `
        <span class="browser-tab-title">${incognito ? '<i data-feather="lock" class="icon icon-small"></i> ' : ''}New Tab</span>
        <button class="browser-tab-close" title="Close tab"><i data-feather="x" class="icon icon-small"></i></button>
      `;
      if (typeof feather !== 'undefined') feather.replace();

      // Insert before new tab button
      if (browserNewTabBtn && browserNewTabBtn.parentNode) {
        browserNewTabBtn.parentNode.insertBefore(tabButton, browserNewTabBtn);
      }

      // Create tab content with webview
      const tabContent = document.createElement('div');
      tabContent.className = 'browser-tab-content';
      tabContent.id = `tab-content-${tabId}`;
      tabContent.dataset.tabId = tabId;

      const webview = document.createElement('webview');
      webview.id = `webview-${tabId}`;
      webview.src = url;
      webview.style.cssText = 'flex: 1; width: 100%; height: 100%; background: white; border: none; min-height: 0;';

      // Set partition for incognito (use temporary partition for true incognito)
      if (incognito) {
        webview.partition = `incognito-${tabId}`; // Temporary partition, cleared on close
      }

      tabContent.appendChild(webview);
      browserTabsContent.appendChild(tabContent);

      // Tab close button
      const closeBtn = tabButton.querySelector('.browser-tab-close');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tabId);
      });

      // Tab click to switch
      tabButton.addEventListener('click', () => {
        switchTab(tabId);
      });

      // Webview event handlers
      webview.addEventListener('did-start-loading', () => {
        tab.loading = true;
        const titleEl = tabButton.querySelector('.browser-tab-title');
        if (titleEl) {
          titleEl.innerHTML = (incognito ? '<i data-feather="lock" class="icon icon-small"></i> ' : '') + 'Loading...';
          if (typeof feather !== 'undefined') feather.replace();
        }
        // Don't update navigation buttons on start-loading, webview not ready yet
        // Disable buttons instead
        if (browserBack) browserBack.disabled = true;
        if (browserForward) browserForward.disabled = true;
      });

      webview.addEventListener('did-stop-loading', () => {
        tab.loading = false;
        try {
          tab.url = webview.getURL();
        } catch (e) {
          console.warn('Cannot get webview URL:', e.message);
        }
        updateTabTitle(tabId);
        // Use setTimeout to ensure webview is fully ready before checking navigation
        setTimeout(() => {
          try {
            updateNavigationButtons(tabId);
          } catch (e) {
            console.warn('Error updating navigation buttons:', e.message);
          }
        }, 100);

        if (activeTabId === tabId && browserUrl) {
          browserUrl.value = tab.url;
        }
      });

      // Also listen for dom-ready event to update navigation buttons
      webview.addEventListener('dom-ready', () => {
        setTimeout(() => {
          try {
            updateNavigationButtons(tabId);
          } catch (e) {
            console.warn('Error updating navigation buttons after dom-ready:', e.message);
          }
        }, 100);
      });

      webview.addEventListener('page-title-updated', (event) => {
        tab.title = event.title || 'New Tab';
        updateTabTitle(tabId);
      });

      webview.addEventListener('did-fail-load', (event) => {
        tab.loading = false;
        if (event.errorCode !== -3) {
          console.error('Browser load failed:', event);
          if (window.logsPanel) {
            window.logsPanel.addLog('error', `Browser navigation failed: ${event.errorDescription || 'Unknown error'}`, null, {
              source: 'Browser',
              errorCode: event.errorCode,
              url: event.validatedURL
            });
          }
        }
      });

      webview.addEventListener('new-window', (event) => {
        event.preventDefault();
        // Open in new tab
        createTab(event.url, incognito);
      });

      // Switch to new tab
      switchTab(tabId);

      return tabId;
    }

    function closeTab(tabId) {
      const tabIndex = tabs.findIndex(t => t.id === tabId);
      if (tabIndex === -1) return;

      const tab = tabs[tabIndex];

      // Clean up incognito session if needed
      if (tab.incognito && window.electronAPI) {
        // Request main process to clear session
        const webview = document.getElementById(`webview-${tabId}`);
        if (webview) {
          try {
            // Clear webview session data
            webview.clearHistory();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }

      // Remove tab from array
      tabs.splice(tabIndex, 1);

      // Remove tab button
      const tabButton = document.querySelector(`.browser-tab[data-tab-id="${tabId}"]`);
      if (tabButton) tabButton.remove();

      // Remove tab content
      const tabContent = document.getElementById(`tab-content-${tabId}`);
      if (tabContent) {
        const webview = tabContent.querySelector('webview');
        if (webview) {
          webview.remove();
        }
        tabContent.remove();
      }

      // Switch to another tab if closing active tab
      if (activeTabId === tabId) {
        if (tabs.length > 0) {
          switchTab(tabs[tabs.length - 1].id);
        } else {
          activeTabId = null;
          if (browserUrl) browserUrl.value = '';
          updateNavigationButtons(null);
        }
      }

      // Close browser if no tabs left
      if (tabs.length === 0) {
        hideBrowser();
      }
    }

    function switchTab(tabId) {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;

      activeTabId = tabId;

      // Update tab buttons
      document.querySelectorAll('.browser-tab').forEach(btn => {
        btn.classList.remove('active');
      });
      const activeTabButton = document.querySelector(`.browser-tab[data-tab-id="${tabId}"]`);
      if (activeTabButton) activeTabButton.classList.add('active');

      // Update tab content visibility
      document.querySelectorAll('.browser-tab-content').forEach(content => {
        content.classList.remove('active');
      });
      const activeTabContent = document.getElementById(`tab-content-${tabId}`);
      if (activeTabContent) activeTabContent.classList.add('active');

      // Update URL bar
      if (browserUrl) {
        browserUrl.value = tab.url || 'https://www.google.com';
      }

      updateNavigationButtons(tabId);
    }

    function updateTabTitle(tabId) {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;

      const tabButton = document.querySelector(`.browser-tab[data-tab-id="${tabId}"]`);
      if (tabButton) {
        const titleEl = tabButton.querySelector('.browser-tab-title');
        if (titleEl) {
          const displayTitle = tab.title.length > 20 ? tab.title.substring(0, 20) + '...' : tab.title;
          titleEl.innerHTML = (tab.incognito ? '<i data-feather="lock" class="icon icon-small"></i> ' : '') + displayTitle;
          if (typeof feather !== 'undefined') feather.replace();
        }
      }
    }

    function navigate(url) {
      if (!activeTabId) return;

      const tab = tabs.find(t => t.id === activeTabId);
      if (!tab) return;

      let finalUrl = url.trim();

      // Add protocol if missing
      if (!finalUrl.match(/^https?:\/\//i)) {
        // Check if it looks like a domain
        if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
          finalUrl = 'https://' + finalUrl;
        } else {
          // Treat as search query
          finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl);
        }
      }

      const webview = document.getElementById(`webview-${activeTabId}`);
      if (webview) {
        webview.src = finalUrl;
        tab.url = finalUrl;
        if (browserUrl) browserUrl.value = finalUrl;
      }
    }

    function updateNavigationButtons(tabId) {
      try {
        if (!tabId) {
          if (browserBack) browserBack.disabled = true;
          if (browserForward) browserForward.disabled = true;
          return;
        }

        const webview = document.getElementById(`webview-${tabId}`);
        if (!webview) {
          if (browserBack) browserBack.disabled = true;
          if (browserForward) browserForward.disabled = true;
          return;
        }

        // Robust check for webview readiness
        // The error "WebView must be attached to the DOM" can be thrown by simple property access
        // so we wrap everything in try-catch

        // Try to access webview properties safely
        let isReady = false;
        try {
          // Accessing getWebContentsId might throw if not ready
          isReady = webview.getWebContentsId && typeof webview.getWebContentsId === 'function';
        } catch (e) {
          // Ignore access errors
          isReady = false;
        }

        if (isReady) {
          if (browserBack) {
            try {
              browserBack.disabled = !webview.canGoBack();
            } catch (e) {
              browserBack.disabled = true;
            }
          }
          if (browserForward) {
            try {
              browserForward.disabled = !webview.canGoForward();
            } catch (e) {
              browserForward.disabled = true;
            }
          }
        } else {
          // Not ready
          if (browserBack) browserBack.disabled = true;
          if (browserForward) browserForward.disabled = true;
        }
      } catch (error) {
        // Global safety catch
        console.warn('WebView navigation button update failed:', error.message);
        try {
          if (browserBack) browserBack.disabled = true;
          if (browserForward) browserForward.disabled = true;
        } catch (e) {
          // Ignore
        }
      }
    }

    // Browser button toggle
    browserButton?.addEventListener('click', () => {
      if (isBrowserOpen) {
        hideBrowser();
      } else {
        showBrowser();
      }
    });

    // Close browser button
    browserCloseBtn?.addEventListener('click', () => {
      hideBrowser();
    });

    // New tab button
    browserNewTabBtn?.addEventListener('click', () => {
      createTab('https://www.google.com', false);
    });

    // New incognito tab button
    browserNewIncognitoTabBtn?.addEventListener('click', () => {
      createTab('https://www.google.com', true);
    });

    // New window button
    browserNewWindowBtn?.addEventListener('click', async () => {
      if (window.electronAPI && window.electronAPI.createBrowserWindow) {
        try {
          const result = await window.electronAPI.createBrowserWindow({
            url: 'https://www.google.com',
            incognito: false
          });
          if (!result.success && window.logsPanel) {
            window.logsPanel.addLog('error', `Failed to create browser window: ${result.error}`, null, {
              source: 'Browser'
            });
          }
        } catch (error) {
          console.error('Failed to create browser window:', error);
        }
      }
    });

    // Incognito window button
    browserIncognitoBtn?.addEventListener('click', async () => {
      if (window.electronAPI && window.electronAPI.createBrowserWindow) {
        try {
          const result = await window.electronAPI.createBrowserWindow({
            url: 'https://www.google.com',
            incognito: true
          });
          if (!result.success && window.logsPanel) {
            window.logsPanel.addLog('error', `Failed to create incognito window: ${result.error}`, null, {
              source: 'Browser'
            });
          }
        } catch (error) {
          console.error('Failed to create incognito window:', error);
        }
      }
    });

    // Navigate on Go button or Enter key
    browserGo?.addEventListener('click', () => {
      if (browserUrl) {
        navigate(browserUrl.value);
      }
    });

    browserUrl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigate(browserUrl.value);
      }
    });

    // Navigation buttons
    browserBack?.addEventListener('click', () => {
      if (!activeTabId) return;
      const webview = document.getElementById(`webview-${activeTabId}`);
      if (webview && webview.canGoBack()) {
        webview.goBack();
      }
    });

    browserForward?.addEventListener('click', () => {
      if (!activeTabId) return;
      const webview = document.getElementById(`webview-${activeTabId}`);
      if (webview && webview.canGoForward()) {
        webview.goForward();
      }
    });

    browserHome?.addEventListener('click', () => {
      navigate('https://www.google.com');
    });

    browserRefresh?.addEventListener('click', () => {
      if (!activeTabId) return;
      const webview = document.getElementById(`webview-${activeTabId}`);
      if (webview) {
        webview.reload();
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupBrowserView();
      setupNavigation();
      initialize();
    });
  } else {
    setupBrowserView();
    setupNavigation();
    initialize();
  }

})();

