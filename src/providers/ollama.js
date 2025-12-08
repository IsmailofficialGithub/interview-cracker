/**
 * Ollama Provider
 * Integration with local Ollama server
 */

const axios = require('axios');
const BaseProvider = require('./base-provider');

class OllamaProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.baseURL = config.baseURL || 'http://localhost:11434';
    this.model = config.model || 'llama2';
    this.timeout = config.timeout || 60000; // Longer timeout for local
  }
  
  validateConfig() {
    // Ollama doesn't require API key
    return true;
  }
  
  /**
   * Send message
   */
  async sendMessage(messages, options = {}) {
    this.validateConfig();
    
    const model = options.model || this.model;
    const stream = options.stream || false;
    
    try {
      // Convert messages to Ollama format
      const lastMessage = messages[messages.length - 1];
      const contextMessages = messages.slice(0, -1);
      
      const response = await axios.post(
        `${this.baseURL}/api/chat`,
        {
          model,
          messages: [
            ...contextMessages,
            lastMessage
          ],
          stream
        },
        {
          timeout: this.timeout,
          responseType: stream ? 'stream' : 'json'
        }
      );
      
      if (stream) {
        return this.handleStreamResponse(response.data);
      } else {
        return {
          content: response.data.message.content,
          model: response.data.model,
          finishReason: response.data.done ? 'stop' : 'length'
        };
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Ollama. Is Ollama running?');
      }
      if (error.response) {
        throw new Error(`Ollama API error: ${error.response.data?.error || error.message}`);
      }
      throw new Error(`Network error: ${error.message}`);
    }
  }
  
  /**
   * Stream message
   */
  async streamMessage(messages, options = {}, onChunk = null) {
    this.validateConfig();
    
    const model = options.model || this.model;
    let fullContent = '';
    
    return new Promise((resolve, reject) => {
      axios.post(
        `${this.baseURL}/api/chat`,
        {
          model,
          messages,
          stream: true
        },
        {
          timeout: this.timeout,
          responseType: 'stream'
        }
      ).then(response => {
        response.data.on('data', (chunk) => {
          const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
          
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              
              if (json.message?.content) {
                fullContent += json.message.content;
                if (onChunk) {
                  onChunk(json.message.content);
                }
              }
              
              if (json.done) {
                resolve({
                  content: fullContent,
                  model: json.model || model,
                  finishReason: 'stop'
                });
                return;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        });
        
        response.data.on('error', (error) => {
          reject(new Error(`Stream error: ${error.message}`));
        });
      }).catch(error => {
        if (error.code === 'ECONNREFUSED') {
          reject(new Error('Cannot connect to Ollama. Is Ollama running?'));
        } else if (error.response) {
          reject(new Error(`Ollama API error: ${error.response.data?.error || error.message}`));
        } else {
          reject(new Error(`Network error: ${error.message}`));
        }
      });
    });
  }
  
  /**
   * Handle stream response
   */
  async handleStreamResponse(stream) {
    let fullContent = '';
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            
            if (json.message?.content) {
              fullContent += json.message.content;
            }
            
            if (json.done) {
              resolve({
                content: fullContent,
                model: json.model || this.model,
                finishReason: 'stop'
              });
              return;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      });
      
      stream.on('error', reject);
    });
  }
  
  /**
   * Get available models (requires Ollama API call)
   */
  async getModels() {
    try {
      const response = await axios.get(`${this.baseURL}/api/tags`, {
        timeout: 5000
      });
      
      if (response.data && response.data.models) {
        return response.data.models.map(m => m.name);
      }
      
      return ['llama2', 'mistral', 'codellama']; // Defaults
    } catch (error) {
      // Return defaults if API call fails
      return ['llama2', 'mistral', 'codellama'];
    }
  }
}

module.exports = OllamaProvider;

