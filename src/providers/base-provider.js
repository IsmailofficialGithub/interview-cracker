/**
 * Base AI Provider
 * Abstract base class for AI providers
 */

class BaseProvider {
  constructor(config) {
    this.config = config;
    this.name = config.name || 'Unknown';
  }
  
  /**
   * Send message to AI provider
   * @param {Array} messages - Array of message objects {role: 'user'|'assistant', content: string}
   * @param {Object} options - Options for the request
   * @returns {Promise<Object>} Response object
   */
  async sendMessage(messages, options = {}) {
    throw new Error('sendMessage must be implemented by subclass');
  }
  
  /**
   * Stream message to AI provider
   * @param {Array} messages - Array of message objects
   * @param {Object} options - Options for the request
   * @param {Function} onChunk - Callback for each chunk
   * @returns {Promise<string>} Full response
   */
  async streamMessage(messages, options = {}, onChunk = null) {
    throw new Error('streamMessage must be implemented by subclass');
  }
  
  /**
   * Validate provider configuration
   * @returns {boolean} True if valid
   */
  validateConfig() {
    return true;
  }
  
  /**
   * Get available models
   * @returns {Array} Array of model names
   */
  async getModels() {
    return [];
  }
}

module.exports = BaseProvider;

