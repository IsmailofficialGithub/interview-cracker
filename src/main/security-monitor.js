/**
 * Security Monitor
 * Monitors and logs security-related events
 */

let initialized = false;
let errorCount = 0;
const MAX_ERROR_LOG = 100;

/**
 * Initialize security monitor
 */
function initialize() {
  initialized = true;
  errorCount = 0;
}

/**
 * Log security event
 * @param {string} eventType - Type of event
 * @param {Object} details - Event details (no sensitive data)
 */
function logSecurityEvent(eventType, details = {}) {
  if (!initialized) return;
  
  // In a full implementation, this would write to encrypted audit log
  // For now, just log to console in development
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Security Event]', eventType, details);
  }
  
  // Could call audit-log.writeAuditLog() here
  // Requires encryption key, so would need to pass it in
}

/**
 * Log error
 * @param {Error} error - Error object
 */
function logError(error) {
  errorCount++;
  
  if (errorCount > MAX_ERROR_LOG) {
    return; // Prevent log flooding
  }
  
  const errorDetails = {
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 lines only
    timestamp: new Date().toISOString()
  };
  
  logSecurityEvent('error', errorDetails);
}

/**
 * Log failed login attempt
 */
function logFailedLogin() {
  logSecurityEvent('failed_login_attempt', {
    timestamp: new Date().toISOString()
  });
}

/**
 * Log successful authentication
 */
function logSuccessfulAuth() {
  logSecurityEvent('successful_auth', {
    timestamp: new Date().toISOString()
  });
}

/**
 * Log encryption error
 */
function logEncryptionError(details) {
  logSecurityEvent('encryption_error', {
    ...details,
    timestamp: new Date().toISOString()
  });
}

/**
 * Shutdown security monitor
 */
function shutdown() {
  initialized = false;
}

module.exports = {
  initialize,
  logSecurityEvent,
  logError,
  logFailedLogin,
  logSuccessfulAuth,
  logEncryptionError,
  shutdown
};

