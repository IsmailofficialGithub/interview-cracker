/**
 * Audit Log Module
 * Encrypted security event logging
 */

const path = require('path');
const fs = require('fs').promises;
const { writeEncryptedJSON, readEncryptedJSON, ensureDirectory } = require('./secure-storage');

const AUDIT_LOG_DIR = 'audit';
const MAX_LOG_ENTRIES = 1000; // Keep last 1000 entries

/**
 * Create audit log entry
 * @param {string} eventType - Type of event
 * @param {Object} details - Event details (no sensitive data)
 * @returns {Object} Audit log entry
 */
function createAuditEntry(eventType, details = {}) {
  return {
    timestamp: new Date().toISOString(),
    eventType,
    details,
    // Add any other metadata (but no sensitive data)
  };
}

/**
 * Write audit log entry
 * @param {string} eventType - Event type
 * @param {Object} details - Event details
 * @param {Buffer} key - Encryption key
 */
async function writeAuditLog(eventType, details, key) {
  try {
    const userDataPath = require('./secure-storage').getUserDataPath();
    const auditDir = path.join(userDataPath, AUDIT_LOG_DIR);
    await ensureDirectory(auditDir);
    
    // Create log entry
    const entry = createAuditEntry(eventType, details);
    
    // Use timestamp-based filename
    const timestamp = Date.now();
    const logFile = path.join(auditDir, `${timestamp}.enc`);
    
    // Write encrypted log entry
    await writeEncryptedJSON(logFile, entry, key);
    
    // Rotate logs if needed (simple implementation)
    await rotateLogs(auditDir, key);
  } catch (error) {
    // Don't throw - audit logging should not break the app
    console.error('Failed to write audit log:', error.message);
  }
}

/**
 * Rotate old log files
 * @param {string} auditDir - Audit directory
 * @param {Buffer} key - Encryption key
 */
async function rotateLogs(auditDir, key) {
  try {
    const files = await fs.readdir(auditDir);
    const logFiles = files.filter(f => f.endsWith('.enc'));
    
    if (logFiles.length > MAX_LOG_ENTRIES) {
      // Sort by filename (timestamp)
      logFiles.sort();
      
      // Delete oldest entries
      const toDelete = logFiles.slice(0, logFiles.length - MAX_LOG_ENTRIES);
      for (const file of toDelete) {
        await fs.unlink(path.join(auditDir, file));
      }
    }
  } catch (error) {
    // Ignore rotation errors
    console.error('Failed to rotate audit logs:', error.message);
  }
}

/**
 * Read audit logs (for admin/debugging purposes)
 * @param {number} limit - Maximum number of entries
 * @param {Buffer} key - Decryption key
 * @returns {Array} Array of audit log entries
 */
async function readAuditLogs(limit = 100, key) {
  try {
    const userDataPath = require('./secure-storage').getUserDataPath();
    const auditDir = path.join(userDataPath, AUDIT_LOG_DIR);
    
    try {
      await fs.access(auditDir);
    } catch {
      return []; // No audit logs yet
    }
    
    const files = await fs.readdir(auditDir);
    const logFiles = files.filter(f => f.endsWith('.enc')).sort().reverse();
    
    const entries = [];
    for (const file of logFiles.slice(0, limit)) {
      try {
        const entry = await readEncryptedJSON(
          path.join(AUDIT_LOG_DIR, file),
          key
        );
        if (entry) {
          entries.push(entry);
        }
      } catch (error) {
        // Skip corrupted entries
        console.error(`Failed to read audit log ${file}:`, error.message);
      }
    }
    
    return entries;
  } catch (error) {
    console.error('Failed to read audit logs:', error.message);
    return [];
  }
}

module.exports = {
  writeAuditLog,
  readAuditLogs,
  createAuditEntry
};

