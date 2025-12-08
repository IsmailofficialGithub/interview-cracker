/**
 * OpenAI-Compatible Provider
 * Generic provider for OpenAI-compatible APIs (LocalAI, text-generation-webui, etc.)
 */

const axios = require('axios');
const BaseProvider = require('./base-provider');

class OpenAICompatibleProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.baseURL = config.baseURL || 'http://localhost:8080';
    this.model = config.model || 'gpt-3.5-turbo';
    this.apiKey = config.apiKey || ''; // Optional
    this.timeout = config.timeout || 60000;
  }
  
  validateConfig() {
    if (!this.baseURL || this.baseURL.trim() === '') {
      throw new Error('Base URL is required for OpenAI-compatible provider');
    }
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
      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      
      const response = await axios.post(
        `${this.baseURL}/v1/chat/completions`,
        {
          model,
          messages,
          stream,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 2048
        },
        {
          headers,
          timeout: this.timeout,
          responseType: stream ? 'stream' : 'json'
        }
      );
      
      if (stream) {
        return this.handleStreamResponse(response.data);
      } else {
        return {
          content: response.data.choices[0].message.content,
          model: response.data.model,
          usage: response.data.usage,
          finishReason: response.data.choices[0].finish_reason
        };
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to ${this.baseURL}. Is the server running?`);
      }
      if (error.response) {
        throw new Error(`API error: ${error.response.data?.error?.message || error.message}`);
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
    
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    return new Promise((resolve, reject) => {
      axios.post(
        `${this.baseURL}/v1/chat/completions`,
        {
          model,
          messages,
          stream: true,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 2048
        },
        {
          headers,
          timeout: this.timeout,
          responseType: 'stream'
        }
      ).then(response => {
        response.data.on('data', (chunk) => {
          const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              
              if (data === '[DONE]') {
                resolve({
                  content: fullContent,
                  model: model,
                  finishReason: 'stop'
                });
                return;
              }
              
              try {
                const json = JSON.parse(data);
                const delta = json.choices[0]?.delta?.content;
                
                if (delta) {
                  fullContent += delta;
                  if (onChunk) {
                    onChunk(delta);
                  }
                }
              } catch (e) {
                // Ignore JSON parse errors
              }
            }
          }
        });
        
        response.data.on('error', (error) => {
          reject(new Error(`Stream error: ${error.message}`));
        });
      }).catch(error => {
        if (error.code === 'ECONNREFUSED') {
          reject(new Error(`Cannot connect to ${this.baseURL}. Is the server running?`));
        } else if (error.response) {
          reject(new Error(`API error: ${error.response.data?.error?.message || error.message}`));
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
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              resolve({
                content: fullContent,
                finishReason: 'stop'
              });
              return;
            }
            
            try {
              const json = JSON.parse(data);
              const delta = json.choices[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      });
      
      stream.on('error', reject);
    });
  }
  
  /**
   * Get available models (may not be supported by all providers)
   */
  async getModels() {
    try {
      const response = await axios.get(`${this.baseURL}/v1/models`, {
        timeout: 5000
      });
      
      if (response.data && response.data.data) {
        return response.data.data.map(m => m.id);
      }
      
      return [this.model]; // Return default model
    } catch (error) {
      // Return default if API call fails
      return [this.model];
    }
  }
}

module.exports = OpenAICompatibleProvider;

