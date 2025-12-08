/**
 * OpenAI Provider
 * Integration with OpenAI API (GPT-3.5, GPT-4, etc.)
 */

const axios = require('axios');
const BaseProvider = require('./base-provider');

class OpenAIProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-3.5-turbo';
    this.baseURL = config.baseURL || 'https://api.openai.com/v1';
    this.timeout = config.timeout || 30000;
  }
  
  validateConfig() {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('OpenAI API key is required');
    }
    return true;
  }
  
  /**
   * Send message with streaming support
   */
  async sendMessage(messages, options = {}) {
    this.validateConfig();
    
    const model = options.model || this.model;
    const stream = options.stream || false;
    
    try {
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model,
          messages,
          stream,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 2048
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: this.timeout,
          responseType: stream ? 'stream' : 'json'
        }
      );
      
      if (stream) {
        // Handle streaming response
        return this.handleStreamResponse(response.data);
      } else {
        // Handle regular response
        return {
          content: response.data.choices[0].message.content,
          model: response.data.model,
          usage: response.data.usage,
          finishReason: response.data.choices[0].finish_reason
        };
      }
    } catch (error) {
      if (error.response) {
        throw new Error(`OpenAI API error: ${error.response.data?.error?.message || error.message}`);
      }
      throw new Error(`Network error: ${error.message}`);
    }
  }
  
  /**
   * Stream message with chunk callbacks
   */
  async streamMessage(messages, options = {}, onChunk = null) {
    this.validateConfig();
    
    const model = options.model || this.model;
    let fullContent = '';
    
    return new Promise((resolve, reject) => {
      axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model,
          messages,
          stream: true,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 2048
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
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
        if (error.response) {
          reject(new Error(`OpenAI API error: ${error.response.data?.error?.message || error.message}`));
        } else {
          reject(new Error(`Network error: ${error.message}`));
        }
      });
    });
  }
  
  /**
   * Handle stream response (for non-callback usage)
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
   * Get available models
   */
  async getModels() {
    return [
      'gpt-4',
      'gpt-4-turbo-preview',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k'
    ];
  }
}

module.exports = OpenAIProvider;

