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
const windowManagerService = require('./window-manager-service');
const appDiscoveryService = require('./app-discovery-service');

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
  const { app } = require('electron');

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
  ipcMain.handle('save-chat', async (event, chatId, chatData) => {
    try {
      const key = getSessionKey();
      if (!key) {
        return { success: false, error: 'Not authenticated' };
      }

      // Handle both old format (array of messages) and new format (object with messages and context)
      let dataToSave;
      if (Array.isArray(chatData)) {
        // Old format - just messages, no context
        dataToSave = {
          messages: chatData,
          context: null
        };
      } else {
        // New format - object with messages and context
        dataToSave = {
          messages: chatData.messages || [],
          context: chatData.context || null
        };
      }

      const chatPath = path.join('chats', `${chatId}.enc`);
      await writeEncryptedJSON(chatPath, dataToSave, key);

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
      const data = await readEncryptedJSON(chatPath, key);

      // Handle backward compatibility - if data is array, wrap it
      if (Array.isArray(data)) {
        return { success: true, data: { messages: data, context: null } };
      }

      // New format with context
      return { success: true, data: data || { messages: [], context: null } };
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

              // Try to load chat to get preview and context
              const chatData = await readEncryptedJSON(path.join('chats', file), key);
              // Handle both old format (array) and new format (object)
              const messages = Array.isArray(chatData) ? chatData : (chatData?.messages || []);
              const context = Array.isArray(chatData) ? null : (chatData?.context || null);
              const lastMessage = messages && messages.length > 0 ? messages[messages.length - 1] : null;

              return {
                id: chatId,
                name: chatId === 'default' ? 'Default Chat' : chatId,
                preview: lastMessage?.content?.substring(0, 50) || 'No messages yet',
                context: context,
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

      // Fix: If account is configured as "openai-compatible" but uses OpenAI's API URL,
      // or has no baseURL but has an API key (likely OpenAI), automatically use the OpenAI provider instead
      let providerType = providerConfig.type || '';
      const baseURL = (providerConfig.baseURL || '').trim();
      const apiKey = (providerConfig.apiKey || '').trim();
      const model = (providerConfig.model || '').toLowerCase();
      
      // Always log for debugging
      securityMonitor.logInfo(`[Provider Check] type="${providerType}", name="${providerConfig.name || 'unknown'}", baseURL="${baseURL || 'none'}", hasApiKey=${!!apiKey && apiKey.length > 0}, model="${model || 'none'}"`);
      
      if (providerType === 'openai-compatible') {
        // PRIORITY 1: Check model name first (most reliable indicator)
        // Check if model contains "gpt" (covers gpt-3.5-turbo, gpt-4, etc.)
        const isOpenAIModel = model && model.includes('gpt');
        
        if (isOpenAIModel) {
          providerType = 'openai';
          securityMonitor.logInfo(`✓ Auto-correcting: openai-compatible -> openai (detected OpenAI model: ${providerConfig.model || model})`);
        }
        
        // PRIORITY 2: Check if baseURL points to OpenAI API
        if (providerType === 'openai-compatible' && baseURL) {
          const baseURLLower = baseURL.toLowerCase();
          if (baseURLLower.includes('api.openai.com')) {
            providerType = 'openai';
            securityMonitor.logInfo(`✓ Auto-correcting: openai-compatible -> openai (detected OpenAI API URL: ${baseURL})`);
          }
        }
        
        // PRIORITY 3: Check for API key (openai-compatible typically doesn't need keys)
        if (providerType === 'openai-compatible' && apiKey && apiKey.length > 0) {
          providerType = 'openai';
          securityMonitor.logInfo(`✓ Auto-correcting: openai-compatible -> openai (has API key but no baseURL)`);
        }
        
        // Final check - if still openai-compatible with default localhost, warn
        if (providerType === 'openai-compatible' && (!baseURL || baseURL === 'http://localhost:8080')) {
          securityMonitor.logInfo(`⚠ Warning: openai-compatible provider "${providerConfig.name}" will use default localhost:8080`);
        }
      }
      
      // Log final provider type
      if (providerConfig.type === 'openai-compatible' && providerType !== providerConfig.type) {
        securityMonitor.logInfo(`[Provider Correction] Changed from "${providerConfig.type}" to "${providerType}"`);
      }

      let provider;
      switch (providerType) {
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

  // Send message to AI with real-time streaming via IPC events
  ipcMain.handle('send-ai-message-stream', async (event, providerConfig, messages, channel) => {
    try {
      const key = getSessionKey();
      if (!key) {
        return { success: false, error: 'Not authenticated' };
      }

      // DEBUG: Log full providerConfig received
      securityMonitor.logInfo(`[DEBUG] Received providerConfig:`, {
        name: providerConfig.name,
        type: providerConfig.type,
        model: providerConfig.model,
        hasApiKey: !!providerConfig.apiKey,
        apiKeyLength: providerConfig.apiKey ? providerConfig.apiKey.length : 0,
        apiKeyPreview: providerConfig.apiKey ? providerConfig.apiKey.substring(0, 10) + '...' : 'none',
        hasBaseURL: !!providerConfig.baseURL,
        baseURL: providerConfig.baseURL || 'none'
      });

      // Load provider modules
      const OpenAIProvider = require('../providers/openai');
      const OllamaProvider = require('../providers/ollama');
      const OpenAICompatibleProvider = require('../providers/openai-compatible');
      const GroqProvider = require('../providers/groq');

      // Fix: If account is configured as "openai-compatible" but uses OpenAI's API URL,
      // or has no baseURL but has an API key (likely OpenAI), automatically use the OpenAI provider instead
      let providerType = providerConfig.type || '';
      const baseURL = (providerConfig.baseURL || '').trim();
      const apiKey = (providerConfig.apiKey || '').trim();
      const model = (providerConfig.model || '').toLowerCase();
      
      // Always log for debugging
      securityMonitor.logInfo(`[Provider Check] type="${providerType}", name="${providerConfig.name || 'unknown'}", baseURL="${baseURL || 'none'}", hasApiKey=${!!apiKey && apiKey.length > 0}, apiKeyLength=${apiKey.length}, model="${model || 'none'}"`);
      
      if (providerType === 'openai-compatible') {
        // PRIORITY 1: Check model name first (most reliable indicator)
        // Check if model contains "gpt" (covers gpt-3.5-turbo, gpt-4, etc.)
        const isOpenAIModel = model && model.includes('gpt');
        
        if (isOpenAIModel) {
          providerType = 'openai';
          securityMonitor.logInfo(`✓ Auto-correcting: openai-compatible -> openai (detected OpenAI model: ${providerConfig.model || model})`);
        }
        
        // PRIORITY 2: Check if baseURL points to OpenAI API
        if (providerType === 'openai-compatible' && baseURL) {
          const baseURLLower = baseURL.toLowerCase();
          if (baseURLLower.includes('api.openai.com')) {
            providerType = 'openai';
            securityMonitor.logInfo(`✓ Auto-correcting: openai-compatible -> openai (detected OpenAI API URL: ${baseURL})`);
          }
        }
        
        // PRIORITY 3: Check for API key (openai-compatible typically doesn't need keys)
        if (providerType === 'openai-compatible' && apiKey && apiKey.length > 0) {
          providerType = 'openai';
          securityMonitor.logInfo(`✓ Auto-correcting: openai-compatible -> openai (has API key but no baseURL)`);
        }
        
        // Final check - if still openai-compatible with default localhost, warn
        if (providerType === 'openai-compatible' && (!baseURL || baseURL === 'http://localhost:8080')) {
          securityMonitor.logInfo(`⚠ Warning: openai-compatible provider "${providerConfig.name}" will use default localhost:8080`);
        }
      }
      
      // Log final provider type
      if (providerConfig.type === 'openai-compatible' && providerType !== providerConfig.type) {
        securityMonitor.logInfo(`[Provider Correction] Changed from "${providerConfig.type}" to "${providerType}"`);
      }

      // Validate API key before creating provider
      if (providerType === 'openai') {
        const apiKey = (providerConfig.apiKey || '').trim();
        securityMonitor.logInfo(`[DEBUG] Validating OpenAI API key:`, {
          accountName: providerConfig.name,
          hasApiKey: !!apiKey,
          apiKeyLength: apiKey.length,
          apiKeyPreview: apiKey ? apiKey.substring(0, 10) + '...' + apiKey.slice(-4) : 'none',
          apiKeyStartsWith: apiKey ? apiKey.substring(0, 7) : 'none'
        });
        
        if (!apiKey) {
          securityMonitor.logError(`[Error] OpenAI provider missing API key for account "${providerConfig.name}"`);
          return { 
            success: false, 
            error: 'OpenAI API key is required. Please add your API key in Settings → AI Accounts.' 
          };
        }
        securityMonitor.logInfo(`[Provider] OpenAI account "${providerConfig.name}" has API key (length: ${apiKey.length})`);
      }

      // DEBUG: Log before creating provider
      securityMonitor.logInfo(`[DEBUG] Creating provider:`, {
        type: providerType,
        name: providerConfig.name,
        model: providerConfig.model,
        apiKeyLength: providerConfig.apiKey ? providerConfig.apiKey.length : 0
      });

      let provider;
      switch (providerType) {
        case 'openai':
          provider = new OpenAIProvider(providerConfig);
          securityMonitor.logInfo(`[DEBUG] OpenAIProvider created with apiKey length: ${provider.apiKey ? provider.apiKey.length : 0}`);
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

      // Stream message and send chunks via IPC events
      await provider.streamMessage(messages, {}, (chunk) => {
        // Send chunk to renderer via IPC event
        event.sender.send(channel, chunk);
      });

      // Send done signal
      event.sender.send(channel, '[DONE]');

      return { success: true };
    } catch (error) {
      // Send error via channel
      if (channel) {
        event.sender.send(channel, `[ERROR]${error.message}`);
      }
      return { success: false, error: error.message };
    }
  });

  // Lock session (clear session key)
  ipcMain.handle('lock-session', async () => {
    setSessionKey(null);
    return { success: true };
  });

  // Toggle always on top (but always enforce it stays on top)
  ipcMain.handle('toggle-always-on-top', async () => {
    try {
      // Use the main window passed in registerHandlers
      if (mainWindow) {
        // Always ensure window is on top - don't allow disabling
        // This ensures the app always stays on top as requested
        if (!mainWindow.isAlwaysOnTop()) {
          mainWindow.setAlwaysOnTop(true);
        }

        // Bring window to front
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        mainWindow.focus();
        // Re-apply always-on-top to ensure it's active
        mainWindow.setAlwaysOnTop(true);

        return { success: true, alwaysOnTop: true };
      }
      return { success: false, error: 'Main window not available' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Bring window to front
  ipcMain.handle('bring-window-to-front', async () => {
    try {
      if (mainWindow) {
        // Ensure always-on-top is enabled first
        if (!mainWindow.isAlwaysOnTop()) {
          mainWindow.setAlwaysOnTop(true);
        }

        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }

        // Show and focus the window
        if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        mainWindow.focus();

        // Re-apply always-on-top to ensure it stays active
        mainWindow.setAlwaysOnTop(true);

        return { success: true };
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
      } else if (Array.isArray(audioData)) {
        // Convert standard Array (from Array.from(uint8Array)) to Buffer
        audioBuffer = Buffer.from(audioData);
      } else if (typeof audioData === 'string') {
        // Assume it's a file path
        tempFile = audioData;
      } else {
        return { success: false, error: 'Invalid audio data format. Expected Buffer, Uint8Array, ArrayBuffer, or Array.' };
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

  // Quit app
  ipcMain.handle('quit-app', async () => {
    app.quit();
    return { success: true };
  });

  // Get desktop sources for screen/audio capture
  ipcMain.handle('get-desktop-sources', async (event, options = {}) => {
    try {
      const { desktopCapturer } = require('electron');
      const sourceTypes = options.types || ['window', 'screen'];
      const sources = await desktopCapturer.getSources({
        types: sourceTypes,
        fetchWindowIcons: false
      });
      return {
        success: true,
        sources: sources.map(source => ({
          id: source.id,
          name: source.name,
          thumbnail: source.thumbnail.toDataURL()
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Create new browser window
  ipcMain.handle('create-browser-window', async (event, options = {}) => {
    try {
      const { BrowserWindow } = require('electron');
      const url = options.url || 'https://www.google.com';
      const incognito = options.incognito || false;

      // Store partition name for cleanup
      const partitionName = incognito ? `persist:incognito-${Date.now()}` : 'persist:default';

      // Create a new browser window
      const browserWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 600,
        minHeight: 400,
        backgroundColor: '#1a1a1a',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
          preload: path.join(__dirname, '../preload/preload.js'),
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: true,
          // Use partition for incognito mode
          partition: partitionName
        },
        show: false,
        frame: true,
        titleBarStyle: 'default',
        skipTaskbar: true, // Hide from taskbar
        icon: path.join(__dirname, '../../assets/icon.png')
      });

      // Security: Enable content protection
      browserWindow.setContentProtection(true);
      browserWindow.setAlwaysOnTop(true);

      // Create HTML content for browser window
      const browserHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' https:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; webview-src *; frame-src *;">
  <title>${incognito ? 'Incognito' : 'Browser'} - Private AI Chat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .browser-toolbar {
      background: #252525;
      border-bottom: 1px solid #333;
      padding: 8px 12px;
      display: flex;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
    }
    .browser-nav-btn {
      background: #333;
      border: 1px solid #444;
      color: #e0e0e0;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      min-width: 32px;
    }
    .browser-nav-btn:hover { background: #3a3a3a; }
    .browser-nav-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .browser-url-bar {
      flex: 1;
      background: #1a1a1a;
      border: 1px solid #444;
      color: #e0e0e0;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 14px;
      font-family: inherit;
    }
    .browser-url-bar:focus {
      outline: none;
      border-color: #4a9eff;
    }
    .browser-refresh-btn {
      background: #333;
      border: 1px solid #444;
      color: #e0e0e0;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      min-width: 32px;
    }
    .browser-refresh-btn:hover { background: #3a3a3a; }
    .incognito-indicator {
      background: #ff4444;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }
      width: 100%;
      background: #fff;
      border: none;
      display: none;
    }
    webview.active {
      display: flex;
    }
    
    .tab-bar {
      display: flex;
      background: #1e1e1e;
      border-bottom: 1px solid #333;
      overflow-x: auto;
      height: 36px;
    }
    .tab {
      display: flex;
      align-items: center;
      padding: 0 12px;
      background: #2d2d2d;
      color: #999;
      border-right: 1px solid #333;
      min-width: 120px;
      max-width: 200px;
      cursor: pointer;
      user-select: none;
      font-size: 13px;
    }
    .tab:hover {
      background: #333;
    }
    .tab.active {
      background: #252525;
      color: #fff;
      border-top: 2px solid #0066cc;
    }
    .tab-title {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-right: 8px;
    }
    .tab-close {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      opacity: 0.6;
    }
    .tab-close:hover {
      background: #444;
      opacity: 1;
    }
    .new-tab-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: transparent;
      border: none;
      color: #999;
      cursor: pointer;
    }
    .new-tab-btn:hover {
      background: #333;
      color: #fff;
    }
    #browser-webview-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
    }
  </style>
</head>
<body>
  <div class="tab-bar" id="tab-bar">
    <button class="new-tab-btn" id="new-tab-btn" title="New Tab"><i data-feather="plus" class="icon"></i></button>
  </div>
  <div class="browser-toolbar">
    ${incognito ? '<div class="incognito-indicator"><i data-feather="lock" class="icon icon-small"></i> Incognito</div>' : ''}
    <button id="browser-back" class="browser-nav-btn" title="Back"><i data-feather="chevron-left" class="icon"></i></button>
    <button id="browser-forward" class="browser-nav-btn" title="Forward"><i data-feather="chevron-right" class="icon"></i></button>
    <button id="browser-home" class="browser-nav-btn" title="Home"><i data-feather="home" class="icon"></i></button>
    <input type="text" id="browser-url" class="browser-url-bar" placeholder="Enter URL or search...">
    <button id="browser-go" class="browser-nav-btn" title="Go">Go</button>
    <button id="browser-refresh" class="browser-refresh-btn" title="Refresh"><i data-feather="refresh-cw" class="icon"></i></button>
  </div>
  <div id="browser-webview-container"></div>

  <script>
    const container = document.getElementById('browser-webview-container');
    const tabBar = document.getElementById('tab-bar');
    const newTabBtn = document.getElementById('new-tab-btn');
    const urlBar = document.getElementById('browser-url');
    const backBtn = document.getElementById('browser-back');
    const forwardBtn = document.getElementById('browser-forward');
    const homeBtn = document.getElementById('browser-home');
    const goBtn = document.getElementById('browser-go');
    const refreshBtn = document.getElementById('browser-refresh');
    
    let tabs = [];
    let activeTabId = null;

    function createTab(url = '${url}') {
      const tabId = 'tab-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      
      // Create Tab UI
      const tabEl = document.createElement('div');
      tabEl.className = 'tab';
      tabEl.id = 'ui-' + tabId;
      tabEl.innerHTML = \`
        <span class="tab-title">New Tab</span>
        <span class="tab-close" onclick="closeTab('\${tabId}', event)">✕</span>
      \`;
      tabEl.onclick = () => switchTab(tabId);
      
      // Create WebView
      const webview = document.createElement('webview');
      webview.id = tabId;
      webview.src = url;
      webview.setAttribute('allowpopups', '');
      webview.setAttribute('disablewebsecurity', ''); 
      // Note: setContentProtection on parent window covers this webview

      webview.style.flex = '1';
      webview.style.width = '100%';
      
      // Attach listeners
      webview.addEventListener('did-start-loading', () => {
        if (activeTabId === tabId) updateNavButtons();
      });
      
      webview.addEventListener('did-stop-loading', () => {
        if (activeTabId === tabId) {
          urlBar.value = webview.getURL();
          updateNavButtons();
        }
        updateTabTitle(tabId);
      });
      
      webview.addEventListener('page-title-updated', (e) => {
        updateTabTitle(tabId, e.title);
      });
      
      webview.addEventListener('new-window', (e) => {
        e.preventDefault();
        // Force open in new TAB in the same window
        createTab(e.url && e.url !== 'about:blank' ? e.url : 'https://www.google.com');
      });
      
      // Inject Ctrl+Click handler
      webview.addEventListener('dom-ready', () => {
        webview.executeJavaScript(\`
          document.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey) {
              const link = e.target.closest('a');
              if (link && link.href) {
                e.preventDefault();
                e.stopPropagation();
                console.log('__OpEn_NeW_tAb__:' + link.href);
              }
            }
          }, true);
        \`);
      });
      
      // Listen for the signal
      webview.addEventListener('console-message', (e) => {
        if (e.message.startsWith('__OpEn_NeW_tAb__:')) {
          const url = e.message.substring(17);
          createTab(url);
        }
      });

      // Add to DOM
      container.appendChild(webview);
      tabBar.insertBefore(tabEl, newTabBtn);
      
      tabs.push(tabId);
      switchTab(tabId);
      
      return tabId;
    }

    function switchTab(tabId) {
      if (activeTabId === tabId) return;
      
      // Deactivate current
      if (activeTabId) {
        document.getElementById('ui-' + activeTabId)?.classList.remove('active');
        document.getElementById(activeTabId)?.classList.remove('active');
      }
      
      // Activate new
      activeTabId = tabId;
      const tabEl = document.getElementById('ui-' + tabId);
      const webview = document.getElementById(tabId);
      
      if (tabEl && webview) {
        tabEl.classList.add('active');
        webview.classList.add('active');
        urlBar.value = webview.getURL();
        updateNavButtons();
        // Scroll tab into view
        tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function closeTab(tabId, event) {
      if (event) event.stopPropagation();
      
      const index = tabs.indexOf(tabId);
      if (index === -1) return;
      
      // Remove UI
      document.getElementById('ui-' + tabId)?.remove();
      document.getElementById(tabId)?.remove();
      
      tabs.splice(index, 1);
      
      // If closing active tab, switch to neighbor
      if (activeTabId === tabId) {
        if (tabs.length > 0) {
          // Try switching to the tab to the right, or the one to the left
          const newIndex = index < tabs.length ? index : index - 1;
          switchTab(tabs[newIndex]);
        } else {
          // No tabs left - close window? OR create new empty tab
          window.close();
        }
      }
    }

    function updateTabTitle(tabId, title) {
      const webview = document.getElementById(tabId);
      const tabEl = document.getElementById('ui-' + tabId);
      if (webview && tabEl) {
        const displayTitle = title || webview.getTitle() || 'New Tab';
        tabEl.querySelector('.tab-title').textContent = displayTitle;
        if (activeTabId === tabId) {
          document.title = displayTitle + ' - Private AI Chat Browser';
        }
      }
    }
    
    function getActiveWebview() {
      return document.getElementById(activeTabId);
    }

    function navigate(url) {
      const webview = getActiveWebview();
      if (!webview) return;
      
      let finalUrl = url.trim();
      if (!finalUrl.match(/^https?:\\/\\//i)) {
        if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
          finalUrl = 'https://' + finalUrl;
        } else {
          finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl);
        }
      }
      webview.src = finalUrl;
    }
    
    function updateNavButtons() {
      const webview = getActiveWebview();
      if (!webview) return;
      
      backBtn.disabled = !webview.canGoBack();
      forwardBtn.disabled = !webview.canGoForward();
    }
    
    // Global Listeners
    newTabBtn.addEventListener('click', () => createTab('https://www.google.com'));
    
    goBtn.addEventListener('click', () => navigate(urlBar.value));
    urlBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigate(urlBar.value);
    });
    
    backBtn.addEventListener('click', () => {
      const wv = getActiveWebview();
      if (wv && wv.canGoBack()) wv.goBack();
    });
    
    forwardBtn.addEventListener('click', () => {
      const wv = getActiveWebview();
      if (wv && wv.canGoForward()) wv.goForward();
    });
    
    homeBtn.addEventListener('click', () => navigate('https://www.google.com'));
    
    refreshBtn.addEventListener('click', () => {
      const wv = getActiveWebview();
      if (wv) wv.reload();
    });
    
    // Initialize first tab
    createTab('${url}');
  </script>
</body>
</html>`;

      // Load the HTML content
      browserWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(browserHTML)}`);

      browserWindow.once('ready-to-show', () => {
        browserWindow.show();
      });

      browserWindow.on('closed', () => {
        // Clean up incognito session if needed
        if (incognito) {
          const { session } = require('electron');
          try {
            const incognitoSession = session.fromPartition(partitionName);
            incognitoSession.clearStorageData({
              storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
            });
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      });

      return { success: true, windowId: browserWindow.id };
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message };
    }
  });

  // Get installed applications
  ipcMain.handle('get-installed-apps', async () => {
    try {
      const apps = await appDiscoveryService.getCachedApps();
      return { success: true, apps };
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message, apps: [] };
    }
  });

  // Launch application and embed
  ipcMain.handle('launch-app', async (event, appPath, tabId) => {
    try {
      const result = await windowManagerService.launchAndEmbed(appPath, tabId);
      return result;
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message };
    }
  });

  // Switch tab (show/hide embedded windows)
  ipcMain.handle('switch-tab', async (event, fromTabId, toTabId) => {
    try {
      if (fromTabId) {
        windowManagerService.hideTab(fromTabId);
      }
      if (toTabId) {
        windowManagerService.showTab(toTabId);
      }
      return { success: true };
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message };
    }
  });

  // Close tab
  ipcMain.handle('close-tab', async (event, tabId) => {
    try {
      const result = windowManagerService.closeTab(tabId);
      return result;
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message };
    }
  });

  // Resize embedded window
  ipcMain.handle('resize-embedded-window', async (event, tabId, width, height) => {
    try {
      const result = windowManagerService.resizeWindow(tabId, width, height);
      return result;
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message };
    }
  });

  // Move embedded window
  ipcMain.handle('move-embedded-window', async (event, tabId, x, y) => {
    try {
      const result = windowManagerService.moveWindow(tabId, x, y);
      return result;
    } catch (error) {
      securityMonitor.logError(error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerHandlers
};

