/**
 * Renderer Process
 * Main frontend application logic
 * 
 * Note: This file uses ES modules for browser compatibility
 * The UI modules need to be bundled or converted to ES modules
 */

// Import marked for Markdown rendering
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@11.1.1/+esm';

// For now, we'll define the classes inline or load them separately
// In production, use a bundler (webpack, rollup, etc.)

let chatUI = null;
let authModal = null;
let settingsPanel = null;
let currentProviderId = null;
let config = null;

/**
 * Initialize application
 */
async function initialize() {
  // Check authentication status
  const sessionStatus = await window.electronAPI.getSessionStatus();
  
  if (!sessionStatus.authenticated) {
    // Check if password is already set up
    await showAuthModal();
  } else {
    // Load application
    await loadApplication();
  }
}

/**
 * Show authentication modal
 */
async function showAuthModal() {
  authModal = new AuthModal();
  
  // Check if password setup is needed
  const status = await window.electronAPI.getSessionStatus();
  const isSetup = !status.authenticated; // Simplified check
  
  // For now, always show verification modal
  // In production, check if .salt.dat exists to determine setup vs login
  authModal.show(false, async () => {
    // On successful auth
    await loadApplication();
  });
}

/**
 * Load application after authentication
 */
async function loadApplication() {
  // Load configuration
  await loadConfig();
  
  // Initialize providers
  await initializeProviders();
  
  // Initialize UI components
  chatUI = new ChatUI();
  chatUI.initialize();
  
  settingsPanel = new SettingsPanel();
  await settingsPanel.initialize();
  
  // Setup settings button
  const settingsBtn = document.getElementById('settings-button');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      settingsPanel.show();
    });
  }
  
  // Setup provider selector
  setupProviderSelector();
  
  // Listen for chat send message event
  window.addEventListener('chat-send-message', async (e) => {
    const content = e.detail.content;
    try {
      await sendAIMessage(content);
    } catch (error) {
      // Error is already handled in sendAIMessage
      console.error('Failed to send message:', error);
    }
  });
}

/**
 * Load configuration
 */
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

/**
 * Initialize AI providers from config
 */
async function initializeProviders() {
  if (!config || !config.accounts) return;
  
  for (const account of config.accounts) {
    try {
      aiProviderManager.registerProvider(account.name, {
        type: account.type,
        apiKey: account.apiKey || '',
        model: account.model,
        baseURL: account.baseURL,
        name: account.name
      });
      
      // Set first provider as current
      if (!currentProviderId) {
        currentProviderId = account.name;
      }
    } catch (error) {
      console.error(`Failed to initialize provider ${account.name}:`, error);
    }
  }
}

/**
 * Setup provider selector dropdown
 */
function setupProviderSelector() {
  const selector = document.getElementById('provider-selector');
  if (!selector) return;
  
  // Populate selector
  const providerIds = aiProviderManager.getProviderIds();
  selector.innerHTML = '';
  
  providerIds.forEach(id => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id;
    selector.appendChild(option);
  });
  
  if (currentProviderId) {
    selector.value = currentProviderId;
  }
  
  // Handle change
  selector.addEventListener('change', (e) => {
    currentProviderId = e.target.value;
  });
}

/**
 * Send message to AI
 */
async function sendAIMessage(messageContent) {
  if (!currentProviderId) {
    throw new Error('No AI provider selected. Please configure an AI account in settings.');
  }
  
  if (!chatUI) {
    throw new Error('Chat UI not initialized');
  }
  
  // Get current chat messages (excluding the "Thinking..." placeholder)
  const existingMessages = chatUI.messages.filter(msg => msg.content !== 'Thinking...');
  const messages = existingMessages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
  
  // Add user message
  messages.push({
    role: 'user',
    content: messageContent
  });
  
  // Stream response
  let fullResponse = '';
  
  try {
    await aiProviderManager.streamMessage(
      currentProviderId,
      messages,
      {},
      (chunk) => {
        fullResponse += chunk;
        chatUI.updateLastAssistantMessage(fullResponse);
      }
    );
    
    // Update final message
    chatUI.updateLastAssistantMessage(fullResponse);
  } catch (error) {
    // Update with error message
    chatUI.updateLastAssistantMessage(`Error: ${error.message}`);
    console.error('AI request failed:', error);
  }
}

// Export for use in ChatUI override
globalSendAIMessage = sendAIMessage;

// Store reference to sendAIMessage for ChatUI
let globalSendAIMessage = null;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

