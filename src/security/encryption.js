/**
 * Encryption Module
 * AES-256-GCM encryption for sensitive data
 */

const crypto = require('crypto');
const { zeroMemory } = require('./memory-protection');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes for GCM (96 bits)
const TAG_LENGTH = 16; // 16 bytes for GCM tag
const KEY_LENGTH = 32; // 32 bytes (256 bits)

/**
 * Generate a random IV for encryption
 * @returns {Buffer} Random IV (12 bytes)
 */
function generateIV() {
  return crypto.randomBytes(IV_LENGTH);
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param {string|Buffer} plaintext - Data to encrypt
 * @param {Buffer} key - Encryption key (32 bytes)
 * @returns {Object} Encrypted data with IV and tag
 */
function encrypt(plaintext, key) {
  if (!key || key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes`);
  }
  
  if (!plaintext) {
    throw new Error('Plaintext cannot be empty');
  }
  
  // Convert string to buffer if needed
  const plaintextBuffer = Buffer.isBuffer(plaintext) 
    ? plaintext 
    : Buffer.from(plaintext, 'utf8');
  
  // Generate random IV
  const iv = generateIV();
  
  try {
    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    // Encrypt
    const encrypted = Buffer.concat([
      cipher.update(plaintextBuffer),
      cipher.final()
    ]);
    
    // Get authentication tag
    const tag = cipher.getAuthTag();
    
    // Combine IV + tag + encrypted data
    const result = {
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64')
    };
    
    // Zero sensitive data
    zeroMemory(plaintextBuffer);
    
    return result;
  } catch (error) {
    // Zero buffers on error
    zeroMemory(plaintextBuffer);
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypt data using AES-256-GCM
 * @param {Object} encryptedData - Encrypted data object with iv, tag, data
 * @param {Buffer} key - Decryption key (32 bytes)
 * @returns {Buffer} Decrypted plaintext
 */
function decrypt(encryptedData, key) {
  if (!key || key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes`);
  }
  
  if (!encryptedData || !encryptedData.iv || !encryptedData.tag || !encryptedData.data) {
    throw new Error('Invalid encrypted data format');
  }
  
  try {
    // Decode base64
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const tag = Buffer.from(encryptedData.tag, 'base64');
    const encrypted = Buffer.from(encryptedData.data, 'base64');
    
    // Verify IV length
    if (iv.length !== IV_LENGTH) {
      throw new Error('Invalid IV length');
    }
    
    // Verify tag length
    if (tag.length !== TAG_LENGTH) {
      throw new Error('Invalid tag length');
    }
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted;
  } catch (error) {
    // Decryption failed (wrong key, corrupted data, etc.)
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Encrypt JSON object
 * @param {Object} obj - Object to encrypt
 * @param {Buffer} key - Encryption key
 * @returns {Object} Encrypted data
 */
function encryptJSON(obj, key) {
  const jsonString = JSON.stringify(obj);
  return encrypt(jsonString, key);
}

/**
 * Decrypt to JSON object
 * @param {Object} encryptedData - Encrypted data
 * @param {Buffer} key - Decryption key
 * @returns {Object} Decrypted object
 */
function decryptJSON(encryptedData, key) {
  const decrypted = decrypt(encryptedData, key);
  const jsonString = decrypted.toString('utf8');
  return JSON.parse(jsonString);
}

module.exports = {
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
  generateIV,
  IV_LENGTH,
  TAG_LENGTH,
  KEY_LENGTH,
  ALGORITHM
};

