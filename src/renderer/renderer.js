/**
 * Renderer Process
 * Main frontend application logic
 * 
 * Note: This file uses ES modules for browser compatibility
 * The UI modules need to be bundled or converted to ES modules
 */

// Import marked for Markdown rendering
import { marked } from '../../assets/marked.esm.js';

// For now, we'll define the classes inline or load them separately
// In production, use a bundler (webpack, rollup, etc.)

let chatUI = null;
let authModal = null;
let settingsPanel = null;
let currentProviderId = null;
let config = null;
let voiceAssistant = null;

/**
 * Show new chat modal - DEFINED EARLY
 */
function showNewChatModal() {
  console.log('=== showNewChatModal called ===');
  const modal = document.getElementById('new-chat-modal');
  console.log('Modal element found:', !!modal);

  if (!modal) {
    console.error('ERROR: New chat modal element not found in DOM!');
    alert('Error: Modal not found. Please refresh the page.');
    return;
  }

  // Show the modal - remove hidden attribute and set styles
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
  modal.classList.add('show');

  console.log('Modal display:', modal.style.display);
  console.log('Modal visibility:', modal.style.visibility);

  // Clear and focus inputs
  const nameInput = document.getElementById('new-chat-name');
  if (nameInput) {
    nameInput.value = '';
    setTimeout(() => nameInput.focus(), 100);
  }

  const contextInput = document.getElementById('new-chat-context');
  if (contextInput) {
    contextInput.value = '';
  }

  console.log('Modal should now be visible');
}

/**
 * Hide new chat modal
 */
function hideNewChatModal() {
  console.log('hideNewChatModal called');
  const modal = document.getElementById('new-chat-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.visibility = 'hidden';
    modal.style.opacity = '0';
    modal.setAttribute('hidden', 'true');
    modal.classList.remove('show');
    console.log('Modal hidden');
  }
}

// Make functions globally available IMMEDIATELY - BEFORE any async operations
// This ensures renderer-bundle.js can access them
if (typeof window !== 'undefined') {
  window.showNewChatModal = showNewChatModal;
  window.hideNewChatModal = hideNewChatModal;
  console.log('showNewChatModal and hideNewChatModal attached to window');
}

/**
 * Initialize application
 * Note: renderer-bundle.js handles main app initialization
 * This function only initializes voice assistant after renderer-bundle.js is ready
 */
async function initialize() {
  // Don't initialize here - let renderer-bundle.js handle it
  // We'll initialize voice assistant when loadApplication is called
  console.log('renderer.js: Skipping main initialization (handled by renderer-bundle.js)');

  // Wait for renderer-bundle.js to initialize, then set up voice assistant
  // This will be called by renderer-bundle.js after it initializes
}

/**
 * Show authentication modal
 */
async function showAuthModal() {
  // Try to use AuthModal from available sources
  if (typeof AuthModal !== 'undefined') {
    authModal = new AuthModal();
  } else if (typeof modules !== 'undefined' && modules.AuthModal) {
    authModal = new modules.AuthModal();
  } else {
    // Try to load from separate file
    console.error('AuthModal class not found');
    throw new Error('AuthModal not available');
  }

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
  // Wait for renderer-bundle.js to initialize first (it loads after this module)
  // Check if renderer-bundle.js has already initialized
  let retries = 0;
  while (!window.chatUI && retries < 20) {
    await new Promise(resolve => setTimeout(resolve, 100));
    retries++;
  }

  if (!window.chatUI) {
    console.warn('renderer-bundle.js has not initialized yet. Voice assistant may not work properly.');
    // Continue anyway - voice assistant will retry
  }

  // Use ChatUI from renderer-bundle.js (it should already be initialized)
  chatUI = window.chatUI;

  if (!chatUI) {
    console.error('ChatUI not available from renderer-bundle.js');
    // Don't throw error, just log - let renderer-bundle.js handle UI
    // Still try to initialize voice assistant if possible
  } else {
    console.log('✅ Using ChatUI from renderer-bundle.js');
  }

  // Initialize Voice Assistant (this is the main purpose of renderer.js)
  try {
    // VoiceAssistant should be available globally from the script tag
    if (typeof VoiceAssistant !== 'undefined' || typeof window.VoiceAssistant !== 'undefined') {
      const VoiceAssistantClass = VoiceAssistant || window.VoiceAssistant;
      voiceAssistant = new VoiceAssistantClass();
      // Pass chatUI reference for message history and context
      await voiceAssistant.initialize(chatUI);

      // Make globally available for old system to check
      window.voiceAssistant = voiceAssistant;
      console.log('✅ VoiceAssistant instance set to window.voiceAssistant');

      // Setup/update global toggle handler for inline onclick handlers
      // This ensures the handler uses the initialized instance
      window.handleVoiceModeToggle = async (mode) => {
        console.log('=== RENDERER.JS TOGGLE HANDLER FIRED ===', mode);
        if (voiceAssistant && typeof voiceAssistant.setMode === 'function') {
          try {
            console.log('Calling voiceAssistant.setMode with:', mode);
            await voiceAssistant.setMode(mode);
            console.log('Mode switched successfully to:', mode);
          } catch (error) {
            console.error('Error switching voice mode:', error);
          }
        } else {
          console.warn('VoiceAssistant not available or setMode not found in renderer.js handler');
        }
      };
      console.log('✅ handleVoiceModeToggle handler updated in renderer.js');

      // Setup callbacks
      voiceAssistant.onTranscription = (text) => {
        // Show transcription in chat
        if (chatUI && chatUI.messages) {
          chatUI.addMessage('user', text);
        }
      };

      voiceAssistant.onResponse = (response, isComplete) => {
        // Show response in chat
        if (chatUI && chatUI.messages) {
          if (isComplete) {
            // Check if there's already an assistant message being streamed
            const lastMsg = chatUI.messages[chatUI.messages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === 'Thinking...') {
              // Replace thinking message
              chatUI.messages[chatUI.messages.length - 1].content = response;
              chatUI.rerenderMessages();
            } else {
              chatUI.addMessage('assistant', response);
            }
          } else {
            // Update streaming response
            const lastMsg = chatUI.messages[chatUI.messages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              chatUI.updateLastAssistantMessage(response);
            } else {
              // Add new message if none exists
              chatUI.addMessage('assistant', response);
            }
          }
        }
      };

      voiceAssistant.onError = (error) => {
        console.error('Voice Assistant Error:', error);
        if (chatUI && chatUI.messages) {
          chatUI.addMessage('assistant', `[Error] ${error}`);
        }
      };

      console.log('Voice Assistant initialized successfully');
    } else {
      console.warn('VoiceAssistant class not found. Voice assistant features will not be available.');
    }
  } catch (error) {
    console.error('Failed to initialize Voice Assistant:', error);
  }

  // Settings button and provider selector are handled by renderer-bundle.js
  // We don't need to set them up here

  // FORCE HIDE modal on startup - multiple ways to ensure it's hidden
  const modal = document.getElementById('new-chat-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.visibility = 'hidden';
    modal.style.opacity = '0';
    modal.setAttribute('hidden', 'true');
    modal.classList.remove('show');
    console.log('Modal forcefully hidden on startup');
  }

  // Setup new chat modal handlers
  setupNewChatModal();

  // Functions are already globally available (defined at top of file)

  // Setup new chat button - use event delegation since button might be in hidden sidebar
  // Use capture phase to run before renderer-bundle.js handler
  document.addEventListener('click', (e) => {
    // Check if clicked element or its parent is the new-chat-btn
    const target = e.target.closest('#new-chat-btn') ||
      (e.target.id === 'new-chat-btn' ? e.target : null) ||
      (e.target.closest('.new-chat-btn') ? e.target.closest('.new-chat-btn') : null);
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      console.log('New chat button clicked - showing modal', target);
      showNewChatModal();
      return false;
    }
  }, true); // Capture phase

  // Also try direct attachment as fallback
  setTimeout(() => {
    const newChatBtn = document.getElementById('new-chat-btn');
    if (newChatBtn) {
      console.log('Found new-chat-btn, attaching direct handler');
      newChatBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Direct handler: New chat button clicked');
        showNewChatModal();
      }, true);
    }
  }, 1000);

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
 * Setup new chat modal handlers
 */
function setupNewChatModal() {
  const modal = document.getElementById('new-chat-modal');
  const form = document.getElementById('new-chat-form');
  const cancelBtn = document.getElementById('new-chat-cancel');
  const submitBtn = document.getElementById('new-chat-submit');

  console.log('setupNewChatModal called - modal:', !!modal, 'form:', !!form, 'cancelBtn:', !!cancelBtn, 'submitBtn:', !!submitBtn);

  if (!modal || !form || !cancelBtn || !submitBtn) {
    console.warn('Modal elements not found, will retry later');
    // Retry after a delay in case DOM isn't ready
    setTimeout(() => setupNewChatModal(), 500);
    return;
  }

  // Ensure modal is hidden on startup - FORCE HIDE
  modal.style.display = 'none';
  modal.style.visibility = 'hidden';
  modal.style.opacity = '0';
  modal.setAttribute('hidden', 'true');

  // Button handlers are now set up inline in HTML to ensure they work
  // These handlers in renderer.js are backup/override handlers
  // Cancel button handler - use direct button reference
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Cancel button clicked (renderer.js handler)');
      hideNewChatModal();
    }, true);
  }

  // Submit button handler - use direct button reference
  if (submitBtn) {
    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Submit button clicked (renderer.js handler)');
      // Trigger form submit
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }, true);
  }

  // Close on overlay click (but not when clicking inside modal content)
  modal.addEventListener('click', (e) => {
    // Only close if clicking the overlay itself, not the modal content
    if (e.target === modal) {
      console.log('Overlay clicked, closing modal');
      hideNewChatModal();
    }
  });

  // Prevent modal content clicks from closing the modal
  const modalContent = modal.querySelector('.new-chat-modal-content');
  if (modalContent) {
    modalContent.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent click from bubbling to overlay
    });
  }

  // Form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Form submitted');

    const nameInput = document.getElementById('new-chat-name');
    const contextInput = document.getElementById('new-chat-context');

    const chatName = nameInput ? nameInput.value.trim() : '';
    const context = contextInput ? contextInput.value.trim() : '';

    console.log('Creating new chat - name:', chatName, 'context:', context);

    // Generate chat ID
    const chatId = chatName || `chat-${Date.now()}`;

    try {
      // Use the ChatUI from renderer-bundle.js if available
      const activeChatUI = window.chatUI || chatUI;
      if (activeChatUI) {
        if (typeof activeChatUI.switchChat === 'function') {
          await activeChatUI.switchChat(chatId, context || null);
        } else if (typeof activeChatUI.setContext === 'function') {
          // Use setContext if available
          activeChatUI.currentChatId = chatId;
          activeChatUI.setContext(context || null);
          activeChatUI.messages = [];
          await activeChatUI.loadChatHistory();
        } else {
          // Fallback for old ChatUI
          activeChatUI.currentChatId = chatId;
          activeChatUI.context = context || null;
          activeChatUI.messages = [];
          if (typeof activeChatUI.loadChatHistory === 'function') {
            await activeChatUI.loadChatHistory();
          }
        }

        // Clear messages for new chat (new chat should be empty)
        activeChatUI.messages = [];
        if (typeof activeChatUI.rerenderMessages === 'function') {
          activeChatUI.rerenderMessages();
        }

        // Save the new chat with context
        if (typeof activeChatUI.saveChatHistory === 'function') {
          await activeChatUI.saveChatHistory();
        }

        console.log('New chat created successfully - ID:', chatId, 'Context:', context || 'none');
      } else {
        console.error('No ChatUI available');
        alert('Error: Chat UI not initialized. Please refresh the page.');
        return;
      }

      hideNewChatModal();
    } catch (error) {
      console.error('Error creating new chat:', error);
      alert('Error creating new chat: ' + error.message);
    }
  });

  console.log('Modal setup complete - buttons should work now');
}

/**
 * Load configuration (if needed for voice assistant)
 * Note: renderer-bundle.js also loads config, so we can use window.config if available
 */
async function loadConfig() {
  // Check if config is already loaded by renderer-bundle.js
  if (window.config) {
    config = window.config;
    return;
  }

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
 * Send message to AI
 * Note: This function is mainly for voice assistant integration
 * The main chat UI in renderer-bundle.js handles regular message sending
 */
async function sendAIMessage(messageContent) {
  // Use chatUI from window (set by renderer-bundle.js)
  const activeChatUI = window.chatUI || chatUI;

  if (!activeChatUI) {
    throw new Error('Chat UI not initialized');
  }

  // Get current chat messages (excluding the "Thinking..." placeholder)
  const existingMessages = activeChatUI.messages.filter(msg => msg.content !== 'Thinking...');
  const messages = existingMessages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  // Add user message
  messages.push({
    role: 'user',
    content: messageContent
  });

  // Get chat context if available
  const chatContext = (activeChatUI && typeof activeChatUI.getContext === 'function')
    ? activeChatUI.getContext()
    : null;

  // Build messages with system prompt and context
  let systemPrompt = 'You are a helpful AI assistant. Provide clear, accurate responses.';
  if (chatContext) {
    systemPrompt = `Context: ${chatContext}. ${systemPrompt}`;
  }

  // Include context in user message for better awareness
  if (chatContext && messages.length > 0) {
    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg.role === 'user') {
      lastUserMsg.content = `[Context: ${chatContext}] ${lastUserMsg.content}`;
    }
  }

  // Prepend system message
  const messagesWithSystem = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  // Use window.aiProviderManager if available (from renderer-bundle.js)
  const providerManager = window.aiProviderManager || aiProviderManager;
  const activeProviderId = window.currentProviderId || currentProviderId;

  if (!providerManager || !activeProviderId) {
    throw new Error('AI provider not available. Please configure in settings.');
  }

  // Stream response
  let fullResponse = '';

  try {
    await providerManager.streamMessage(
      activeProviderId,
      messagesWithSystem,
      {},
      (chunk) => {
        fullResponse += chunk;
        activeChatUI.updateLastAssistantMessage(fullResponse);
      }
    );

    // Update final message
    activeChatUI.updateLastAssistantMessage(fullResponse);
  } catch (error) {
    // Update with error message
    activeChatUI.updateLastAssistantMessage(`Error: ${error.message}`);
    console.error('AI request failed:', error);
  }
}

// Store reference to sendAIMessage for ChatUI
let globalSendAIMessage = null;

// Export for use in ChatUI override
globalSendAIMessage = sendAIMessage;

// Expose functions to window for debugging
if (typeof window !== 'undefined') {
  window.loadApplication = loadApplication;
  window.rendererInitialize = initialize;
  console.log('✅ renderer.js functions exposed to window');
}

// Don't auto-initialize - let renderer-bundle.js handle initialization
// Voice assistant will be initialized when loadApplication is called
// This prevents conflicts with renderer-bundle.js initialization

// Expose a function that renderer-bundle.js can call after it initializes
window.initializeVoiceAssistant = async function () {
  console.log('Initializing voice assistant from renderer-bundle.js callback');
  await loadApplication();
};

// Test function for debugging - type window.testShowModal() in console
window.testShowModal = function () {
  console.log('=== TEST: Calling showNewChatModal ===');
  if (typeof window.showNewChatModal === 'function') {
    window.showNewChatModal();
  } else {
    console.error('ERROR: window.showNewChatModal not found!');
    alert('Error: showNewChatModal function not available. Check console.');
  }
};

