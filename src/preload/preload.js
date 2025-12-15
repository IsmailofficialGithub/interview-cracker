/**
 * Preload Script
 * Secure IPC bridge between main and renderer processes
 */

const { contextBridge, ipcRenderer } = require('electron');

// Load marked for Markdown rendering
let marked;
try {
  marked = require('marked');
} catch (error) {
  // Fallback if marked is not available
  marked = {
    parse: (text) => {
      // Simple HTML escape and line break conversion
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }
  };
}

// Expose protected methods to renderer
// Security: Only whitelisted methods are exposed
contextBridge.exposeInMainWorld('electronAPI', {
  // Authentication
  verifyPassword: (password) => ipcRenderer.invoke('verify-password', password),
  setupPassword: (password) => ipcRenderer.invoke('setup-password', password),
  getSessionStatus: () => ipcRenderer.invoke('get-session-status'),
  lockSession: () => ipcRenderer.invoke('lock-session'),

  // Chat operations
  saveChat: (chatId, messages) => ipcRenderer.invoke('save-chat', chatId, messages),
  loadChat: (chatId) => ipcRenderer.invoke('load-chat', chatId),
  listChats: () => ipcRenderer.invoke('list-chats'),
  deleteChat: (chatId) => ipcRenderer.invoke('delete-chat', chatId),

  // Configuration
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // AI message (proxied through main process)
  sendAIMessage: (providerConfig, messages) => ipcRenderer.invoke('send-ai-message', providerConfig, messages),

  // AI message with streaming (returns chunks)
  sendAIMessageStream: async (providerConfig, messages, onChunk) => {
    // Use proper streaming via IPC
    return new Promise((resolve, reject) => {
      const channel = `ai-stream-${Date.now()}`;
      let fullContent = '';
      let hasError = false;

      // Listen for chunks
      const chunkHandler = (event, chunk) => {
        // Check for error chunks
        if (typeof chunk === 'string' && chunk.startsWith('[ERROR]')) {
          const errorMsg = chunk.substring(7);
          ipcRenderer.removeListener(channel, chunkHandler);
          hasError = true;
          reject(new Error(errorMsg));
          return;
        }

        if (chunk === '[DONE]') {
          ipcRenderer.removeListener(channel, chunkHandler);
          if (!hasError) {
            resolve({ success: true, content: fullContent });
          }
        } else if (!hasError) {
          // Only accumulate content if no error
          fullContent += chunk;
          if (onChunk) {
            try {
              onChunk(chunk);
            } catch (callbackError) {
              // If callback throws, we still want to handle it
              console.error('Error in onChunk callback:', callbackError);
              // Don't reject here, let the stream continue
            }
          }
        }
      };

      ipcRenderer.on(channel, chunkHandler);

      // Start streaming
      ipcRenderer.invoke('send-ai-message-stream', providerConfig, messages, channel).then(result => {
        if (!result.success) {
          ipcRenderer.removeListener(channel, chunkHandler);
          if (!hasError) {
            reject(new Error(result.error || 'Streaming failed'));
          }
        }
      }).catch(error => {
        ipcRenderer.removeListener(channel, chunkHandler);
        if (!hasError) {
          reject(error);
        }
      });
    });
  },

  // Window events
  onWindowBlur: (callback) => {
    ipcRenderer.on('window-blurred', callback);
    return () => ipcRenderer.removeListener('window-blurred', callback);
  },
  onWindowFocus: (callback) => {
    ipcRenderer.on('window-focused', callback);
    return () => ipcRenderer.removeListener('window-focused', callback);
  },

  // Log events from main process
  onLogError: (callback) => {
    ipcRenderer.on('log-error', (event, logData) => {
      callback(logData);
    });
    return () => ipcRenderer.removeListener('log-error', callback);
  },

  // Always on top controls
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  bringWindowToFront: () => ipcRenderer.invoke('bring-window-to-front'),

  // Voice transcription (OpenAI Whisper or Groq Whisper)
  transcribeAudio: (audioData, apiKey, providerType, model) => ipcRenderer.invoke('transcribe-audio', audioData, apiKey, providerType, model),

  // Utility: Markdown renderer
  renderMarkdown: (text) => marked.parse(text),

  // App control
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Desktop capture
  getDesktopSources: (options) => ipcRenderer.invoke('get-desktop-sources', options),

  // Browser windows
  createBrowserWindow: (options) => ipcRenderer.invoke('create-browser-window', options),

  // Global Shortcut
  updateShortcut: (shortcut) => ipcRenderer.invoke('update-shortcut', shortcut),
  updateGhostShortcut: (shortcut) => ipcRenderer.invoke('update-ghost-shortcut', shortcut),
  updateQuitShortcut: (shortcut) => ipcRenderer.invoke('update-quit-shortcut', shortcut),
  updateGhostWpm: (wpm) => ipcRenderer.invoke('update-ghost-wpm', wpm),
  updateGhostMistakeChance: (chance) => ipcRenderer.invoke('update-ghost-mistake-chance', chance),
  updateGhostMaxMistakes: (max) => ipcRenderer.invoke('update-ghost-max-mistakes', max)
});

// Log that preload script loaded (for debugging)
console.log('Preload script loaded - IPC bridge initialized');

