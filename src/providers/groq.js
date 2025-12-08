/**
 * Groq Provider
 * Integration with Groq API (OpenAI-compatible, fast inference)
 * https://groq.com/
 */

const axios = require('axios');
const BaseProvider = require('./base-provider');

class GroqProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.apiKey;
    this.model = config.model || 'llama-3.1-8b-instant'; // Default Groq chat model
    this.baseURL = config.baseURL || 'https://api.groq.com/openai/v1';
    this.timeout = config.timeout || 30000;
  }
  
  validateConfig() {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('Groq API key is required');
    }
    
      // Validate model name format (Groq models should not have spaces or special chars in certain positions)
      if (this.model && this.model.trim() !== '') {
        // Updated list of current Groq CHAT COMPLETION models (as of 2025)
        // Note: Whisper models are for audio transcription only, not chat completions
        const validChatModels = [
          'llama-3.1-8b-instant',
          'llama-3.3-70b-versatile',
          'llama-3.2-90b-text-preview',
          'llama-3.2-11b-text-preview',
          'llama-3.2-3b-text-preview',
          'llama-3.2-1b-text-preview',
          'llama-3.3-70b-versatile',
          'mixtral-8x7b-32768',
          'gemma-7b-it',
          'gemma2-9b-it',
          'gemma2-27b-it'
        ];
        
        // Deprecated models
        const deprecatedModels = [
          'llama-3.1-70b-versatile'
        ];
        
        // Whisper models (audio only, not for chat)
        const whisperModels = [
          'whisper-large-v3',
          'whisper-large-v3-turbo'
        ];
        
        // Warn if using deprecated model
        if (deprecatedModels.includes(this.model)) {
          console.warn(`⚠️ Model "${this.model}" has been deprecated. Please use a current model like "llama-3.1-8b-instant" or "llama-3.3-70b-versatile".`);
        }
        
        // Warn if using Whisper model for chat (they're audio-only)
        if (whisperModels.includes(this.model)) {
          console.warn(`⚠️ Model "${this.model}" is for audio transcription only, not chat completions. Use it in Voice Input settings, not for chat.`);
        }
        
        // Warn if model doesn't match known models (but don't block, in case of new models)
        if (!validChatModels.includes(this.model) && !whisperModels.includes(this.model)) {
          console.warn(`Groq model "${this.model}" is not in the known models list. It may still work if it's a valid Groq model.`);
        }
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
    
    // Validate model name
    if (!model || model.trim() === '') {
      throw new Error('Model name is required for Groq API');
    }
    
    // Validate that model is not a Whisper model (Whisper is for audio transcription only)
    const whisperModels = ['whisper-large-v3', 'whisper-large-v3-turbo'];
    if (whisperModels.includes(model.trim())) {
      throw new Error(`Model "${model}" is for audio transcription only, not chat completions. Use it in Voice Input settings, not for chat.`);
    }
    
    // Validate messages
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages array is required and cannot be empty');
    }
    
    // Validate each message
    for (const msg of messages) {
      if (!msg.role || !msg.content) {
        throw new Error('Each message must have "role" and "content" fields');
      }
      if (!['system', 'user', 'assistant'].includes(msg.role)) {
        throw new Error(`Invalid message role: ${msg.role}. Must be system, user, or assistant`);
      }
    }
    
    const requestBody = {
      model: model.trim(),
      messages: messages.map(msg => ({
        role: msg.role,
        content: String(msg.content || '')
      })),
      stream: stream || false,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2048
    };
    
    try {
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        requestBody,
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
        const status = error.response.status;
        const errorData = error.response.data;
        
        let errorMessage = `Groq API error (${status})`;
        
        if (errorData?.error?.message) {
          errorMessage = `Groq API error: ${errorData.error.message}`;
        } else if (errorData?.error) {
          errorMessage = `Groq API error: ${JSON.stringify(errorData.error)}`;
        } else if (errorData?.message) {
          errorMessage = `Groq API error: ${errorData.message}`;
        } else if (errorData) {
          errorMessage = `Groq API error: ${JSON.stringify(errorData)}`;
        }
        
        // Add helpful hints for common errors
        if (status === 400) {
          errorMessage += '\n\nPossible causes:\n';
          errorMessage += '- Invalid model name (check model dropdown)\n';
          errorMessage += '- Invalid request format\n';
          errorMessage += '- Missing required parameters\n';
          errorMessage += '- Check your API key is valid';
        } else if (status === 401) {
          errorMessage += '\n\nInvalid API key. Please check your Groq API key in Settings.';
        } else if (status === 429) {
          errorMessage += '\n\nRate limit exceeded. Please try again later.';
        }
        
        throw new Error(errorMessage);
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
    
    // Validate that model is not a Whisper model (Whisper is for audio transcription only)
    const whisperModels = ['whisper-large-v3', 'whisper-large-v3-turbo'];
    if (whisperModels.includes(model.trim())) {
      throw new Error(`Model "${model}" is for audio transcription only, not chat completions. Use it in Voice Input settings, not for chat.`);
    }
    
    let fullContent = '';
    
    return new Promise((resolve, reject) => {
      axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: model.trim(),
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
          const status = error.response.status;
          let errorData = error.response.data;
          let errorMessage = `Groq API error (${status})`;
          
          // Handle stream response - need to read the buffer
          if (errorData && typeof errorData === 'object' && errorData._readableState) {
            // It's a stream, try to extract error from buffer if available
            try {
              const bufferData = errorData._readableState?.buffer?.head?.data;
              
              // Handle different buffer formats
              let bufferArray = null;
              if (bufferData?.data && Array.isArray(bufferData.data)) {
                bufferArray = bufferData.data;
              } else if (Buffer.isBuffer(bufferData)) {
                bufferArray = Array.from(bufferData);
              }
              
              if (bufferArray && bufferArray.length > 0) {
                // Convert buffer array to string (limit to first 2000 bytes)
                const maxBytes = Math.min(bufferArray.length, 2000);
                let errorStr = '';
                for (let i = 0; i < maxBytes; i++) {
                  const byte = bufferArray[i];
                  if (byte >= 32 && byte <= 126) { // Printable ASCII
                    errorStr += String.fromCharCode(byte);
                  } else if (byte === 10 || byte === 13) { // Newline
                    errorStr += '\n';
                  } else {
                    errorStr += '.';
                  }
                }
                
                // Try to parse as JSON
                try {
                  errorData = JSON.parse(errorStr);
                } catch (e) {
                  // If JSON parse fails, try to extract message using regex
                  const messageMatch = errorStr.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                  if (messageMatch) {
                    errorData = { error: { message: messageMatch[1].replace(/\\"/g, '"') } };
                  } else {
                    // Try to find any error object
                    const errorMatch = errorStr.match(/"error"\s*:\s*\{[^}]*"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                    if (errorMatch) {
                      errorData = { error: { message: errorMatch[1].replace(/\\"/g, '"') } };
                    }
                  }
                }
              }
            } catch (e) {
              // Failed to parse stream, continue with default handling
              console.error('Failed to parse stream error:', e);
            }
          }
          
          // Safely extract error message
          try {
            if (errorData?.error?.message) {
              errorMessage = `Groq API error: ${errorData.error.message}`;
            } else if (errorData?.message) {
              errorMessage = `Groq API error: ${errorData.message}`;
            } else if (typeof errorData === 'string') {
              // Try to parse as JSON
              try {
                const parsed = JSON.parse(errorData);
                if (parsed.error?.message) {
                  errorMessage = `Groq API error: ${parsed.error.message}`;
                } else if (parsed.message) {
                  errorMessage = `Groq API error: ${parsed.message}`;
                } else {
                  errorMessage = `Groq API error: ${errorData.substring(0, 200)}`;
                }
              } catch (e) {
                errorMessage = `Groq API error: ${errorData.substring(0, 200)}`;
              }
            } else if (errorData && typeof errorData === 'object') {
              // Try to extract message from object (safely)
              const msg = errorData.error?.message || errorData.message;
              if (msg) {
                errorMessage = `Groq API error: ${msg}`;
              }
            }
          } catch (e) {
            // If extraction fails, use basic error message
            errorMessage = `Groq API error (${status}): ${error.message || 'Unknown error'}`;
          }
          
          if (status === 400) {
            errorMessage += '\n\nTip: Check model name - some models may be deprecated. See Groq docs for current models.';
          }
          
          reject(new Error(errorMessage));
        } else {
          // Handle non-response errors (network, timeout, etc.)
          let errorMsg = `Network error: ${error.message || 'Unknown error'}`;
          
          // Add more context if available
          if (error.code) {
            errorMsg += ` (Code: ${error.code})`;
          }
          
          reject(new Error(errorMsg));
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
    // Return only chat completion models (not Whisper models)
    return [
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
      'llama-3.2-90b-text-preview',
      'llama-3.2-11b-text-preview',
      'llama-3.2-3b-text-preview',
      'llama-3.2-1b-text-preview',
      'mixtral-8x7b-32768',
      'gemma-7b-it',
      'gemma2-9b-it',
      'gemma2-27b-it'
    ];
  }
  
  /**
   * Safely stringify objects, handling circular references
   */
  safeStringify(obj, space = 2) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      // Skip circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      
      // Skip functions
      if (typeof value === 'function') {
        return '[Function]';
      }
      
      // Skip undefined
      if (value === undefined) {
        return '[Undefined]';
      }
      
      // Handle Error objects
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      }
      
      return value;
    }, space);
  }
}

module.exports = GroqProvider;

