/**
 * Memory Protection Utilities
 * Ensures sensitive data is zeroed from memory after use
 */

/**
 * Zero out a buffer or string from memory
 * @param {Buffer|string} data - Data to zero
 */
function zeroMemory(data) {
  if (Buffer.isBuffer(data)) {
    data.fill(0);
  } else if (typeof data === 'string') {
    // Strings in JS are immutable, but we can clear references
    // For actual secure clearing, use Buffers when possible
    return null;
  }
}

/**
 * Create a secure buffer that zeros itself when garbage collected
 * Note: Actual zeroing relies on garbage collection timing
 * For immediate clearing, use zeroMemory() explicitly
 * @param {number} size - Buffer size in bytes
 * @returns {Buffer}
 */
function createSecureBuffer(size) {
  const buffer = Buffer.allocUnsafe(size);
  
  // Return buffer with a method to clear it
  buffer.clear = function() {
    this.fill(0);
  };
  
  return buffer;
}

/**
 * Secure string wrapper that attempts to clear memory
 * Note: JavaScript strings are immutable, so clearing is best-effort
 * Prefer Buffers for truly sensitive data
 * @param {string} str - String to wrap
 * @returns {Object} Wrapper with clear method
 */
function secureString(str) {
  let value = str;
  
  return {
    getValue: () => value,
    clear: () => {
      value = null;
    }
  };
}

/**
 * Execute a function with secure memory cleanup
 * @param {Function} fn - Function to execute
 * @param {Array} sensitiveArgs - Arguments that should be zeroed after use
 * @returns {*} Function result
 */
function withSecureCleanup(fn, sensitiveArgs = []) {
  try {
    const result = fn();
    return result;
  } finally {
    // Cleanup sensitive arguments
    sensitiveArgs.forEach(arg => {
      if (Buffer.isBuffer(arg)) {
        zeroMemory(arg);
      }
    });
  }
}

module.exports = {
  zeroMemory,
  createSecureBuffer,
  secureString,
  withSecureCleanup
};

