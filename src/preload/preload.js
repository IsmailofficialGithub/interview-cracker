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
      
      // Listen for chunks
      const chunkHandler = (event, chunk) => {
        if (chunk === '[DONE]') {
          ipcRenderer.removeListener(channel, chunkHandler);
          resolve({ success: true, content: fullContent });
        } else {
          fullContent += chunk;
          if (onChunk) {
            onChunk(chunk);
          }
        }
      };
      
      ipcRenderer.on(channel, chunkHandler);
      
      // Start streaming
      ipcRenderer.invoke('send-ai-message-stream', providerConfig, messages, channel).then(result => {
        if (!result.success) {
          ipcRenderer.removeListener(channel, chunkHandler);
          reject(new Error(result.error || 'Streaming failed'));
        }
      }).catch(error => {
        ipcRenderer.removeListener(channel, chunkHandler);
        reject(error);
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
  createBrowserWindow: (options) => ipcRenderer.invoke('create-browser-window', options)
});

// Log that preload script loaded (for debugging)
console.log('Preload script loaded - IPC bridge initialized');

