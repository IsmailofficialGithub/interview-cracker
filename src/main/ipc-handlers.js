/**
 * IPC Handlers
 * Secure IPC communication between main and renderer processes
 */

const { ipcMain } = require('electron');
const crypto = require('crypto');
const { deriveMasterKey, generateSalt, verifyPassword } = require('../security/key-derivation');
const { encryptJSON, decryptJSON } = require('../security/encryption');
const { 
  writeEncryptedJSON, 
  readEncryptedJSON, 
  fileExists,
  getUserDataPath 
} = require('../security/secure-storage');
const { writeAuditLog } = require('../security/audit-log');
const securityMonitor = require('./security-monitor');
const fs = require('fs').promises;
const path = require('path');

// Rate limiting for sensitive operations
const rateLimit = {
  passwordAttempts: 0,
  lastAttemptTime: 0,
  maxAttempts: 5,
  cooldownPeriod: 30000 // 30 seconds
};

/**
 * Check rate limit for password attempts
 * @returns {boolean} True if allowed
 */
function checkRateLimit() {
  const now = Date.now();
  
  // Reset if cooldown period has passed
  if (now - rateLimit.lastAttemptTime > rateLimit.cooldownPeriod) {
    rateLimit.passwordAttempts = 0;
  }
  
  if (rateLimit.passwordAttempts >= rateLimit.maxAttempts) {
    return false;
  }
  
  rateLimit.passwordAttempts++;
  rateLimit.lastAttemptTime = now;
  
  return true;
}

/**
 * Reset rate limit
 */
function resetRateLimit() {
  rateLimit.passwordAttempts = 0;
  rateLimit.lastAttemptTime = 0;
}

/**
 * Verify password and return session key
 * @param {string} password - Master password
 * @returns {Buffer|null} Session key or null if invalid
 */
async function verifyPasswordAndGetKey(password) {
  try {
    // Check rate limit
    if (!checkRateLimit()) {
      securityMonitor.logFailedLogin();
      throw new Error('Too many failed attempts. Please wait 30 seconds.');
    }
    
    // Read salt
    const userDataPath = getUserDataPath();
    const saltPath = path.join(userDataPath, '.salt.dat');
    
    const saltData = await fs.readFile(saltPath);
    const salt = Buffer.from(saltData);
    
    // Derive key
    const key = deriveMasterKey(password, salt);
    
    // Verify by attempting to read config
    try {
      await readEncryptedJSON('.config.enc', key);
      // If successful, password is correct
      resetRateLimit();
      securityMonitor.logSuccessfulAuth();
      return key;
    } catch {
      // Wrong password
      securityMonitor.logFailedLogin();
      return null;
    }
  } catch (error) {
    securityMonitor.logFailedLogin();
    throw error;
  }
}

/**
 * Register all IPC handlers
 * @param {BrowserWindow} mainWindow - Main window
 * @param {Function} getSessionKey - Function to get current session key
 * @param {Function} setSessionKey - Function to set session key
 */
function registerHandlers(mainWindow, getSessionKey, setSessionKey) {
  
  // Verify password
  ipcMain.handle('verify-password', async (event, password) => {
    try {
      const key = await verifyPasswordAndGetKey(password);
      if (key) {
        setSessionKey(key);
        return { success: true };
      }
      return { success: false, error: 'Invalid password' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // Setup first-time password
  ipcMain.handle('setup-password', async (event, password) => {
    try {
      // Check if already set up
      if (await fileExists('.salt.dat')) {
        return { success: false, error: 'Password already set up' };
      }
      
      // Validate password
      if (!password || password.length < 12) {
        return { success: false, error: 'Password must be at least 12 characters' };
      }
      
      const userDataPath = getUserDataPath();
      const saltPath = path.join(userDataPath, '.salt.dat');
      
      // Ensure directories exist
      const { ensureDirectory } = require('../security/secure-storage');
      await ensureDirectory(userDataPath);
      const chatsDir = path.join(userDataPath, 'chats');
      await ensureDirectory(chatsDir);
      const auditDir = path.join(userDataPath, 'audit');
      await ensureDirectory(auditDir);
      
      // Generate salt
      const salt = generateSalt();
      await fs.writeFile(saltPath, salt);
      
      // Derive key
      const key = deriveMasterKey(password, salt);
      
      // Create initial config
      const initialConfig = {
        accounts: [],
        settings: {
          autoLock: true,
          autoLockMinutes: 15,
          messageRetentionDays: 0, // 0 = never delete
          autoBlur: false
        }
      };
      
      await writeEncryptedJSON('.config.enc', initialConfig, key);
      
      setSessionKey(key);
      securityMonitor.logSuccessfulAuth();
      
      return { success: true };
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message };
    }
  });
  
  // Get session key status and check if setup is needed
  ipcMain.handle('get-session-status', async () => {
    const key = getSessionKey();
    const needsSetup = !(await fileExists('.salt.dat'));
    return { authenticated: key !== null, needsSetup };
  });
  
  // Save chat
  ipcMain.handle('save-chat', async (event, chatId, messages) => {
    try {
      const key = getSessionKey();
      if (!key) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const chatPath = path.join('chats', `${chatId}.enc`);
      await writeEncryptedJSON(chatPath, messages, key);
      
      return { success: true };
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message };
    }
  });
  
  // Load chat
  ipcMain.handle('load-chat', async (event, chatId) => {
    try {
      const key = getSessionKey();
      if (!key) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const chatPath = path.join('chats', `${chatId}.enc`);
      const messages = await readEncryptedJSON(chatPath, key);
      
      return { success: true, data: messages || [] };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // Delete chat
  ipcMain.handle('delete-chat', async (event, chatId) => {
    try {
      const key = getSessionKey();
      if (!key) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const { secureDelete } = require('../security/secure-storage');
      const userDataPath = getUserDataPath();
      const chatPath = path.join(userDataPath, 'chats', `${chatId}.enc`);
      
      // Delete the chat file
      if (await fileExists(chatPath)) {
        await secureDelete(chatPath);
      }
      
      return { success: true };
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message };
    }
  });
  
  // List chats with metadata
  ipcMain.handle('list-chats', async () => {
    try {
      const key = getSessionKey();
      if (!key) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const userDataPath = getUserDataPath();
      const chatsDir = path.join(userDataPath, 'chats');
      
      // Ensure chats directory exists
      try {
        await fs.access(chatsDir);
      } catch {
        // Directory doesn't exist, create it
        const { ensureDirectory } = require('../security/secure-storage');
        await ensureDirectory(chatsDir);
      }
      
      try {
        const files = await fs.readdir(chatsDir);
        const chatFiles = files.filter(f => f.endsWith('.enc') && f !== '.manifest.enc');
        
        // Get metadata for each chat
        const chats = await Promise.all(
          chatFiles.map(async (file) => {
            const chatId = file.replace('.enc', '');
            const chatPath = path.join(chatsDir, file);
            
            try {
              // Get file stats for date
              const stats = await fs.stat(chatPath);
              
              // Try to load chat to get preview
              const messages = await readEncryptedJSON(path.join('chats', file), key);
              const lastMessage = messages && messages.length > 0 ? messages[messages.length - 1] : null;
              
              return {
                id: chatId,
                name: chatId === 'default' ? 'Default Chat' : chatId,
                preview: lastMessage?.content?.substring(0, 50) || 'No messages yet',
                date: stats.mtime,
                messageCount: messages ? messages.length : 0
              };
            } catch (e) {
              // If we can't read the chat, just return basic info
              const stats = await fs.stat(chatPath);
              return {
                id: chatId,
                name: chatId === 'default' ? 'Default Chat' : chatId,
                preview: 'Unable to load',
                date: stats.mtime,
                messageCount: 0
              };
            }
          })
        );
        
        // Sort by date (newest first)
        chats.sort((a, b) => b.date - a.date);
        
        return { success: true, chats };
      } catch (error) {
        // Return empty array if error
        return { success: true, chats: [] };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // Get config
  ipcMain.handle('get-config', async () => {
    try {
      const key = getSessionKey();
      if (!key) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const config = await readEncryptedJSON('.config.enc', key);
      return { success: true, data: config || { accounts: [], settings: {} } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // Save config
  ipcMain.handle('save-config', async (event, config) => {
    try {
      const key = getSessionKey();
      if (!key) {
        return { success: false, error: 'Not authenticated' };
      }
      
      await writeEncryptedJSON('.config.enc', config, key);
      return { success: true };
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message };
    }
  });
  
  // Send message to AI (proxy through main process for security)
  ipcMain.handle('send-ai-message', async (event, providerConfig, messages) => {
    try {
      const key = getSessionKey();
      if (!key) {
        return { success: false, error: 'Not authenticated' };
      }
      
      // Load provider modules
      const OpenAIProvider = require('../providers/openai');
      const OllamaProvider = require('../providers/ollama');
      const OpenAICompatibleProvider = require('../providers/openai-compatible');
      const GroqProvider = require('../providers/groq');
      
      let provider;
      switch (providerConfig.type) {
        case 'openai':
          provider = new OpenAIProvider(providerConfig);
          break;
        case 'ollama':
          provider = new OllamaProvider(providerConfig);
          break;
        case 'openai-compatible':
          provider = new OpenAICompatibleProvider(providerConfig);
          break;
        case 'groq':
          provider = new GroqProvider(providerConfig);
          break;
        default:
          return { success: false, error: `Unknown provider type: ${providerConfig.type}` };
      }
      
      // Send message with streaming
      let fullContent = '';
      const chunks = [];
      
      await provider.streamMessage(messages, {}, (chunk) => {
        fullContent += chunk;
        chunks.push(chunk);
      });
      
      return {
        success: true,
        content: fullContent,
        chunks: chunks // Send chunks for progressive rendering
      };
    } catch (error) {
      // Safely extract error details without circular references
      const errorDetails = {
        message: error.message || 'Unknown error',
        name: error.name,
        providerType: providerConfig?.type,
        model: providerConfig?.model,
        hasApiKey: !!providerConfig?.apiKey
      };
      
      // If it's an axios error, include response details (safely)
      if (error.response) {
        errorDetails.status = error.response.status;
        errorDetails.statusText = error.response.statusText;
        
        // Safely extract response data
        try {
          if (error.response.data) {
            let responseData = error.response.data;
            
            // Handle stream responses - extract from buffer
            if (responseData && typeof responseData === 'object' && responseData._readableState) {
              try {
                const bufferData = responseData._readableState?.buffer?.head?.data;
                let bufferArray = null;
                
                if (bufferData?.data && Array.isArray(bufferData.data)) {
                  bufferArray = bufferData.data;
                } else if (Buffer.isBuffer(bufferData)) {
                  bufferArray = Array.from(bufferData);
                }
                
                if (bufferArray && bufferArray.length > 0) {
                  const maxBytes = Math.min(bufferArray.length, 1000);
                  let errorStr = '';
                  for (let i = 0; i < maxBytes; i++) {
                    const byte = bufferArray[i];
                    if (byte >= 32 && byte <= 126) {
                      errorStr += String.fromCharCode(byte);
                    }
                  }
                  try {
                    responseData = JSON.parse(errorStr);
                  } catch (e) {
                    responseData = errorStr.substring(0, 500);
                  }
                }
              } catch (e) {
                responseData = '[Unable to parse stream response]';
              }
            }
            
            // Only include simple data types, avoid circular refs
            if (typeof responseData === 'string') {
              errorDetails.responseData = responseData;
            } else if (responseData?.error) {
              errorDetails.responseData = {
                error: {
                  message: responseData.error.message,
                  type: responseData.error.type,
                  code: responseData.error.code
                }
              };
            } else {
              // Try to stringify, but catch circular ref errors
              try {
                errorDetails.responseData = JSON.parse(JSON.stringify(responseData));
              } catch (e) {
                errorDetails.responseData = '[Complex object - see logs]';
              }
            }
          }
        } catch (e) {
          errorDetails.responseData = '[Unable to extract response data]';
        }
      }
      
      // Always return a response to prevent "reply was never sent" error
      return { 
        success: false, 
        error: error.message || 'Unknown error',
        details: errorDetails
      };
    }
  });
  
  // Lock session (clear session key)
  ipcMain.handle('lock-session', async () => {
    setSessionKey(null);
    return { success: true };
  });
  
  // Toggle always on top
  ipcMain.handle('toggle-always-on-top', async () => {
    try {
      // Use the main window passed in registerHandlers
      if (mainWindow) {
        const isOnTop = mainWindow.isAlwaysOnTop();
        mainWindow.setAlwaysOnTop(!isOnTop);
        return { success: true, alwaysOnTop: !isOnTop };
      }
      return { success: false, error: 'Main window not available' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // Get always on top status
  ipcMain.handle('get-always-on-top', async () => {
    try {
      if (mainWindow) {
        return { success: true, alwaysOnTop: mainWindow.isAlwaysOnTop() };
      }
      return { success: false, error: 'Main window not available' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // Transcribe audio using OpenAI Whisper API or Groq Whisper
  ipcMain.handle('transcribe-audio', async (event, audioData, apiKey, providerType = 'openai', model = 'whisper-1') => {
    try {
      const axios = require('axios');
      const FormData = require('form-data');
      const fs = require('fs');
      const path = require('path');
      const { app } = require('electron');
      
      if (!apiKey) {
        return { success: false, error: 'API key required for Whisper transcription' };
      }
      
      // Save audio data to temp file
      const tempDir = app.getPath('temp');
      let tempFile = path.join(tempDir, `audio-${Date.now()}.webm`);
      
      // audioData can be Buffer, Uint8Array, or ArrayBuffer from renderer
      let audioBuffer;
      if (Buffer.isBuffer(audioData)) {
        audioBuffer = audioData;
      } else if (audioData instanceof Uint8Array) {
        // Convert Uint8Array to Buffer
        audioBuffer = Buffer.from(audioData);
      } else if (audioData instanceof ArrayBuffer) {
        // Convert ArrayBuffer to Buffer
        audioBuffer = Buffer.from(audioData);
      } else if (typeof audioData === 'string') {
        // Assume it's a file path
        tempFile = audioData;
      } else {
        return { success: false, error: 'Invalid audio data format. Expected Buffer, Uint8Array, or ArrayBuffer.' };
      }
      
      // Write audio buffer to file if not using file path
      if (audioBuffer) {
        fs.writeFileSync(tempFile, audioBuffer);
      }
      
      // Verify file exists and has content
      if (!fs.existsSync(tempFile)) {
        return { success: false, error: 'Audio file not created' };
      }
      
      const stats = fs.statSync(tempFile);
      if (stats.size === 0) {
        fs.unlinkSync(tempFile);
        return { success: false, error: 'Audio file is empty' };
      }
      
      let transcriptionText = '';
      
      // Log transcription start
      securityMonitor.logInfo(`Starting audio transcription: provider=${providerType}, model=${model}, fileSize=${stats.size} bytes`);
      
      if (providerType === 'groq') {
        // Use Groq SDK for transcription (as per user's code example)
        const Groq = require('groq-sdk');
        const groq = new Groq({ apiKey });
        
        // Groq Whisper models
        const groqWhisperModels = ['whisper-large-v3', 'whisper-large-v3-turbo'];
        const whisperModel = (model && groqWhisperModels.includes(model)) ? model : 'whisper-large-v3-turbo';
        
        securityMonitor.logInfo(`Calling Groq Whisper API: model=${whisperModel}`);
        const apiStartTime = Date.now();
        
        try {
          const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempFile),
            model: whisperModel,
            temperature: 0,
            response_format: 'text'
          });
          
          const apiDuration = Date.now() - apiStartTime;
          securityMonitor.logInfo(`Groq Whisper API response received in ${apiDuration}ms`);
          
          // Groq SDK returns text directly when response_format is 'text'
          // If it's an object, extract the text property
          if (typeof transcription === 'string') {
            transcriptionText = transcription;
          } else if (transcription && transcription.text) {
            transcriptionText = transcription.text;
          } else {
            transcriptionText = String(transcription);
          }
          
          securityMonitor.logInfo(`Groq transcription successful: textLength=${transcriptionText.length} chars, duration=${apiDuration}ms`);
        } catch (groqError) {
          const apiDuration = Date.now() - apiStartTime;
          // Clean up temp file on error
          try {
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
          } catch (e) {
            console.error('Failed to delete temp audio file:', e);
          }
          
          let errorMessage = groqError.message || 'Unknown Groq transcription error';
          if (groqError.response && groqError.response.data) {
            errorMessage = groqError.response.data.error?.message || errorMessage;
          }
          
          securityMonitor.logError(new Error(`Groq transcription failed after ${apiDuration}ms: ${errorMessage}`), {
            provider: 'groq',
            model: whisperModel,
            duration: apiDuration,
            error: errorMessage
          });
          
          return { success: false, error: errorMessage };
        }
      } else {
        // Use OpenAI API (axios for compatibility)
        securityMonitor.logInfo(`Calling OpenAI Whisper API: model=${model || 'whisper-1'}`);
        const apiStartTime = Date.now();
        
        const form = new FormData();
        form.append('file', fs.createReadStream(tempFile), {
          filename: 'audio.webm',
          contentType: 'audio/webm'
        });
        form.append('model', 'whisper-1');
        form.append('language', 'en');
        
        try {
          const response = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            form,
            {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                ...form.getHeaders()
              },
              timeout: 60000, // 60 seconds for audio processing
              maxContentLength: Infinity,
              maxBodyLength: Infinity
            }
          );
          
          const apiDuration = Date.now() - apiStartTime;
          transcriptionText = response.data.text;
          
          securityMonitor.logInfo(`OpenAI transcription successful: textLength=${transcriptionText.length} chars, duration=${apiDuration}ms`);
        } catch (openaiError) {
          const apiDuration = Date.now() - apiStartTime;
          let errorMessage = openaiError.message || 'Unknown OpenAI transcription error';
          
          if (openaiError.response && openaiError.response.data) {
            errorMessage = openaiError.response.data.error?.message || errorMessage;
          }
          
          securityMonitor.logError(new Error(`OpenAI transcription failed after ${apiDuration}ms: ${errorMessage}`), {
            provider: 'openai',
            model: model || 'whisper-1',
            duration: apiDuration,
            error: errorMessage
          });
          
          // Clean up temp file on error
          try {
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
          } catch (e) {
            console.error('Failed to delete temp audio file:', e);
          }
          
          return { success: false, error: errorMessage };
        }
      }
      
      // Clean up temp file
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          securityMonitor.logInfo(`Temporary audio file cleaned up: ${tempFile}`);
        }
      } catch (e) {
        // Ignore cleanup errors
        console.error('Failed to cleanup temp file:', e);
        securityMonitor.logError(new Error(`Failed to cleanup temp file: ${e.message}`));
      }
      
      if (transcriptionText) {
        securityMonitor.logInfo(`Transcription completed successfully: ${transcriptionText.length} characters`);
        return {
          success: true,
          text: transcriptionText
        };
      } else {
        securityMonitor.logError(new Error('No transcription text returned from API'));
        return {
          success: false,
          error: 'No transcription returned from API'
        };
      }
    } catch (error) {
      // Clean up temp file on error
      try {
        if (tempFile && fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (e) {
        // Ignore
      }
      
      let errorMessage = 'Transcription failed';
      if (error.response) {
        errorMessage = error.response.data?.error?.message || error.response.statusText || errorMessage;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  });
}

module.exports = {
  registerHandlers
};

