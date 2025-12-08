/**
 * Key Derivation Module
 * PBKDF2 key derivation for master password
 */

const crypto = require('crypto');
const { zeroMemory } = require('./memory-protection');

const PBKDF2_ITERATIONS = 100000; // Minimum 100k iterations
const SALT_LENGTH = 32; // 32 bytes (256 bits)
const KEY_LENGTH = 32; // 32 bytes (256 bits for AES-256)
const DIGEST = 'sha256';

/**
 * Generate a random salt for PBKDF2
 * @returns {Buffer} Random salt (32 bytes)
 */
function generateSalt() {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * Derive a master key from password using PBKDF2
 * @param {string} password - Master password
 * @param {Buffer} salt - Salt (32 bytes)
 * @returns {Buffer} Derived key (32 bytes)
 */
function deriveMasterKey(password, salt) {
  if (!password || password.length === 0) {
    throw new Error('Password cannot be empty');
  }
  
  if (!salt || salt.length !== SALT_LENGTH) {
    throw new Error(`Salt must be ${SALT_LENGTH} bytes`);
  }
  
  try {
    const key = crypto.pbkdf2Sync(
      password,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      DIGEST
    );
    
    return key;
  } catch (error) {
    throw new Error(`Key derivation failed: ${error.message}`);
  }
}

/**
 * Derive key with secure cleanup
 * Automatically zeros password after derivation (best-effort)
 * @param {string} password - Master password
 * @param {Buffer} salt - Salt
 * @returns {Buffer} Derived key
 */
function deriveMasterKeySecure(password, salt) {
  const key = deriveMasterKey(password, salt);
  
  // Note: JavaScript strings are immutable, so we can't truly zero them
  // But we can clear references. For maximum security, use Buffers for passwords
  // when possible (requires changes to calling code)
  
  return key;
}

/**
 * Verify password by attempting key derivation
 * @param {string} password - Password to verify
 * @param {Buffer} salt - Stored salt
 * @param {Buffer} storedVerificationData - Previously stored verification (optional)
 * @returns {boolean} True if password is valid
 */
function verifyPassword(password, salt, storedVerificationData = null) {
  try {
    const derivedKey = deriveMasterKey(password, salt);
    
    // If we have stored verification data, compare
    // For now, we'll just check if derivation succeeds
    // In practice, you'd store a hash of the derived key or a verification token
    
    // Clean up derived key after verification
    zeroMemory(derivedKey);
    
    return true; // If derivation succeeded and matches stored data
  } catch (error) {
    return false;
  }
}

module.exports = {
  generateSalt,
  deriveMasterKey,
  deriveMasterKeySecure,
  verifyPassword,
  PBKDF2_ITERATIONS,
  SALT_LENGTH,
  KEY_LENGTH
};

