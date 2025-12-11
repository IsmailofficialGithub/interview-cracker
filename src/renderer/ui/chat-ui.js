/**
 * Chat UI Component
 * Manages chat interface and message display
 */

// Marked is available via electronAPI.renderMarkdown

class ChatUI {
  constructor() {
    this.chatContainer = null;
    this.inputArea = null;
    this.sendButton = null;
    this.messages = [];
    this.currentChatId = 'default';
    this.context = null; // Optional context/description for the chat
    this.autoSaveTimer = null;
    this.isBlurred = false;
  }
  
  /**
   * Initialize chat UI
   */
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
    
    // Setup window blur/focus handlers
    window.electronAPI.onWindowBlur(() => {
      this.handleBlur();
    });
    
    window.electronAPI.onWindowFocus(() => {
      this.handleFocus();
    });
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Send button click
    this.sendButton.addEventListener('click', () => {
      this.sendMessage();
    });
    
    // Enter key to send, CTRL+ENTER also
    this.inputArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    
    // Auto-resize textarea
    this.inputArea.addEventListener('input', () => {
      this.inputArea.style.height = 'auto';
      this.inputArea.style.height = `${Math.min(this.inputArea.scrollHeight, 200)}px`;
    });
  }
  
  /**
   * Add message to chat
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - Message content
   */
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
  
  /**
   * Update last assistant message (for streaming)
   * @param {string} content - Updated content
   */
  updateLastAssistantMessage(content) {
    if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'assistant') {
      this.messages[this.messages.length - 1].content = content;
      this.rerenderMessages();
      this.autoScroll();
    }
  }
  
  /**
   * Render a message
   * @param {Object} message - Message object
   */
  renderMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${message.role}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    // Render Markdown
    const html = window.electronAPI ? window.electronAPI.renderMarkdown(message.content) : message.content;
    contentDiv.innerHTML = html;
    
    // Add timestamp
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-timestamp';
    const date = new Date(message.timestamp);
    timestampDiv.textContent = date.toLocaleTimeString();
    
    messageDiv.appendChild(contentDiv);
    messageDiv.appendChild(timestampDiv);
    
    this.chatContainer.appendChild(messageDiv);
  }
  
  /**
   * Rerender all messages
   */
  rerenderMessages() {
    this.chatContainer.innerHTML = '';
    this.messages.forEach(msg => this.renderMessage(msg));
  }
  
  /**
   * Auto-scroll to bottom
   */
  autoScroll() {
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }
  
  /**
   * Send message
   */
  async sendMessage() {
    const content = this.inputArea.value.trim();
    if (!content) return;
    
    // Clear input
    this.inputArea.value = '';
    this.inputArea.style.height = 'auto';
    
    // Add user message
    this.addMessage('user', content);
    
    // Show loading indicator
    this.addMessage('assistant', 'Thinking...');
    
    // Trigger AI message send via window event
    // The renderer.js will handle the actual AI call
    window.dispatchEvent(new CustomEvent('chat-send-message', {
      detail: { content }
    }));
  }
  
  /**
   * Load chat history
   */
  async loadChatHistory() {
    try {
      const result = await window.electronAPI.loadChat(this.currentChatId);
      if (result.success && result.data) {
        // Handle both old format (array of messages) and new format (object with messages and context)
        if (Array.isArray(result.data)) {
          this.messages = result.data;
          this.context = null;
        } else {
          this.messages = result.data.messages || [];
          this.context = result.data.context || null;
        }
        this.rerenderMessages();
        this.autoScroll();
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
    }
  }
  
  /**
   * Save chat history
   */
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
    this.context = context;
    await this.loadChatHistory();
  }
  
  /**
   * Schedule auto-save (debounced)
   */
  scheduleAutoSave() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    
    this.autoSaveTimer = setTimeout(() => {
      this.saveChatHistory();
    }, 10000); // 10 seconds
  }
  
  /**
   * Start auto-save interval
   */
  startAutoSave() {
    setInterval(() => {
      if (this.messages.length > 0) {
        this.saveChatHistory();
      }
    }, 30000); // Save every 30 seconds as backup
  }
  
  /**
   * Handle window blur (privacy mode)
   */
  handleBlur() {
    this.isBlurred = true;
    // Blur effect will be handled by CSS class
    document.body.classList.add('blurred');
  }
  
  /**
   * Handle window focus
   */
  handleFocus() {
    this.isBlurred = false;
    document.body.classList.remove('blurred');
  }
  
  /**
   * Clear chat
   */
  clearChat() {
    this.messages = [];
    this.chatContainer.innerHTML = '';
    this.saveChatHistory();
  }
}

module.exports = ChatUI;

