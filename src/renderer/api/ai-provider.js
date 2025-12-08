/**
 * AI Provider Manager
 * Manages AI provider instances and routing
 */

const OpenAIProvider = require('../../providers/openai');
const OllamaProvider = require('../../providers/ollama');
const OpenAICompatibleProvider = require('../../providers/openai-compatible');
const GroqProvider = require('../../providers/groq');

class AIProviderManager {
  constructor() {
    this.providers = new Map();
  }
  
  /**
   * Register a provider
   * @param {string} id - Provider ID
   * @param {Object} config - Provider configuration
   */
  registerProvider(id, config) {
    let provider;
    
    switch (config.type) {
      case 'openai':
        provider = new OpenAIProvider(config);
        break;
      case 'ollama':
        provider = new OllamaProvider(config);
        break;
      case 'openai-compatible':
        provider = new OpenAICompatibleProvider(config);
        break;
      case 'groq':
        provider = new GroqProvider(config);
        break;
      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
    
    this.providers.set(id, provider);
    return provider;
  }
  
  /**
   * Get provider instance
   * @param {string} id - Provider ID
   * @returns {BaseProvider|null} Provider instance
   */
  getProvider(id) {
    return this.providers.get(id) || null;
  }
  
  /**
   * Send message using provider
   * @param {string} providerId - Provider ID
   * @param {Array} messages - Message array
   * @param {Object} options - Options
   * @returns {Promise<Object>} Response
   */
  async sendMessage(providerId, messages, options = {}) {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    
    return await provider.sendMessage(messages, options);
  }
  
  /**
   * Stream message using provider
   * @param {string} providerId - Provider ID
   * @param {Array} messages - Message array
   * @param {Object} options - Options
   * @param {Function} onChunk - Chunk callback
   * @returns {Promise<Object>} Full response
   */
  async streamMessage(providerId, messages, options = {}, onChunk = null) {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    
    return await provider.streamMessage(messages, options, onChunk);
  }
  
  /**
   * Remove provider
   * @param {string} id - Provider ID
   */
  removeProvider(id) {
    this.providers.delete(id);
  }
  
  /**
   * Get all provider IDs
   * @returns {Array} Provider IDs
   */
  getProviderIds() {
    return Array.from(this.providers.keys());
  }
}

// Create singleton instance
const providerManager = new AIProviderManager();

module.exports = providerManager;

