/**
 * Secure Storage Module
 * Atomic encrypted file operations
 */

const fs = require('fs').promises;
const path = require('path');
const { encryptJSON, decryptJSON } = require('./encryption');
const { zeroMemory } = require('./memory-protection');

/**
 * Get user data directory
 * @returns {string} Path to user data directory
 */
function getUserDataPath() {
  const { app } = require('electron');
  return app.getPath('userData');
}

/**
 * Ensure directory exists
 * @param {string} dirPath - Directory path
 */
async function ensureDirectory(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Atomic write operation
 * Writes to temp file first, then renames for atomicity
 * @param {string} filePath - Target file path
 * @param {Buffer|string} data - Data to write
 */
async function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp`;
  
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await ensureDirectory(dir);
    
    // Write to temp file
    await fs.writeFile(tempPath, data);
    
    // Atomic rename (on Windows, this replaces the file atomically)
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(`Atomic write failed: ${error.message}`);
  }
}

/**
 * Read file safely
 * @param {string} filePath - File path
 * @returns {Buffer} File contents
 */
async function readFile(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // File doesn't exist
    }
    throw error;
  }
}

/**
 * Write encrypted JSON object
 * @param {string} filePath - File path (relative to userData or absolute)
 * @param {Object} data - Object to encrypt and write
 * @param {Buffer} key - Encryption key
 */
async function writeEncryptedJSON(filePath, data, key) {
  const userDataPath = getUserDataPath();
  const fullPath = path.isAbsolute(filePath) 
    ? filePath 
    : path.join(userDataPath, filePath);
  
  // Encrypt data
  const encrypted = encryptJSON(data, key);
  
  // Convert to JSON string for storage
  const encryptedJSON = JSON.stringify(encrypted);
  
  // Atomic write
  await atomicWrite(fullPath, encryptedJSON);
}

/**
 * Read and decrypt JSON object
 * @param {string} filePath - File path
 * @param {Buffer} key - Decryption key
 * @returns {Object|null} Decrypted object or null if file doesn't exist
 */
async function readEncryptedJSON(filePath, key) {
  const userDataPath = getUserDataPath();
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(userDataPath, filePath);
  
  // Read file
  const fileData = await readFile(fullPath);
  if (!fileData) {
    return null;
  }
  
  try {
    // Parse JSON
    const encrypted = JSON.parse(fileData.toString('utf8'));
    
    // Decrypt
    const decrypted = decryptJSON(encrypted, key);
    
    return decrypted;
  } catch (error) {
    throw new Error(`Failed to read encrypted file: ${error.message}`);
  }
}

/**
 * Secure delete (overwrite with random data before deletion)
 * @param {string} filePath - File path to delete
 * @param {number} passes - Number of overwrite passes (default: 1)
 */
async function secureDelete(filePath, passes = 1) {
  const userDataPath = getUserDataPath();
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(userDataPath, filePath);
  
  try {
    // Read file size
    const stats = await fs.stat(fullPath);
    const fileSize = stats.size;
    
    // Overwrite with random data
    for (let i = 0; i < passes; i++) {
      const randomData = require('crypto').randomBytes(fileSize);
      await fs.writeFile(fullPath, randomData);
    }
    
    // Delete file
    await fs.unlink(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Secure delete failed: ${error.message}`);
    }
    // File doesn't exist, that's fine
  }
}

/**
 * Check if file exists
 * @param {string} filePath - File path
 * @returns {boolean} True if file exists
 */
async function fileExists(filePath) {
  const userDataPath = getUserDataPath();
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(userDataPath, filePath);
  
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getUserDataPath,
  ensureDirectory,
  atomicWrite,
  readFile,
  writeEncryptedJSON,
  readEncryptedJSON,
  secureDelete,
  fileExists
};

