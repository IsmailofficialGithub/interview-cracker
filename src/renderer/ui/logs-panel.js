/**
 * Logs Panel
 * Displays application logs, errors, and debug information
 */

class LogsPanel {
  constructor() {
    this.panel = null;
    this.isOpen = false;
    this.logs = [];
    this.maxLogs = 1000; // Keep last 1000 logs
    this.filterLevel = 'all';
  }
  
  /**
   * Initialize logs panel
   */
  initialize() {
    // Listen for console errors and log them
    this.setupErrorHandling();
    
    // Load saved logs from storage
    this.loadLogs();
  }
  
  /**
   * Setup error handling to capture logs
   */
  setupErrorHandling() {
    // Capture console errors
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalLog = console.log;
    
    console.error = (...args) => {
      this.addLog('error', args.join(' '), new Error().stack);
      originalError.apply(console, args);
    };
    
    console.warn = (...args) => {
      this.addLog('warning', args.join(' '));
      originalWarn.apply(console, args);
    };
    
    console.log = (...args) => {
      // Only log if it's an error-like message
      const message = args.join(' ');
      if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
        this.addLog('info', message);
      }
      originalLog.apply(console, args);
    };
    
    // Capture unhandled errors
    window.addEventListener('error', (event) => {
      this.addLog('error', event.message, event.error?.stack, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });
    
    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.addLog('error', `Unhandled Promise Rejection: ${event.reason}`, event.reason?.stack);
    });
  }
  
  /**
   * Add a log entry
   */
  addLog(level, message, stack = null, details = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toLowerCase(),
      message: message || 'No message',
      stack: stack || null,
      details: details || null
    };
    
    this.logs.push(logEntry);
    
    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    
    // Save logs
    this.saveLogs();
    
    // Update UI if panel is open
    if (this.isOpen && this.panel) {
      this.renderLogs();
    }
  }
  
  /**
   * Show logs panel
   */
  show() {
    if (this.isOpen) return;
    
    const panelHTML = `
      <div id="logs-panel" class="logs-panel-overlay">
        <div class="logs-panel-content">
          <div class="logs-header">
            <h2>Application Logs</h2>
            <div class="logs-controls">
              <button id="logs-clear" class="logs-clear-btn">Clear Logs</button>
              <button id="logs-close" class="logs-close-btn">× Close</button>
            </div>
          </div>
          <div class="logs-filter">
            <label style="color: #e0e0e0; font-size: 14px;">Filter:</label>
            <select id="logs-filter-level">
              <option value="all">All Logs</option>
              <option value="error">Errors Only</option>
              <option value="warning">Warnings</option>
              <option value="info">Info</option>
              <option value="success">Success</option>
            </select>
            <span id="logs-count" style="color: #999; font-size: 12px; margin-left: auto;"></span>
          </div>
          <div class="logs-body" id="logs-content">
            ${this.renderLogsHTML()}
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', panelHTML);
    this.panel = document.getElementById('logs-panel');
    this.isOpen = true;
    
    // Setup event listeners
    document.getElementById('logs-close').addEventListener('click', () => {
      this.hide();
    });
    
    document.getElementById('logs-clear').addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all logs?')) {
        this.clearLogs();
      }
    });
    
    document.getElementById('logs-filter-level').addEventListener('change', (e) => {
      this.filterLevel = e.target.value;
      this.renderLogs();
    });
    
    // Close on overlay click
    this.panel.addEventListener('click', (e) => {
      if (e.target === this.panel) {
        this.hide();
      }
    });
    
    // Render logs
    this.renderLogs();
  }
  
  /**
   * Hide logs panel
   */
  hide() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      this.isOpen = false;
    }
  }
  
  /**
   * Render logs HTML
   */
  renderLogsHTML() {
    if (this.logs.length === 0) {
      return '<div class="logs-empty">No logs yet. Logs will appear here when errors or events occur.</div>';
    }
    
    const filteredLogs = this.filterLevel === 'all' 
      ? this.logs 
      : this.logs.filter(log => log.level === this.filterLevel);
    
    if (filteredLogs.length === 0) {
      return `<div class="logs-empty">No ${this.filterLevel} logs found.</div>`;
    }
    
    return filteredLogs.map(log => this.renderLogEntry(log)).join('');
  }
  
  /**
   * Render a single log entry
   */
  renderLogEntry(log) {
    const date = new Date(log.timestamp);
    const timeStr = date.toLocaleString();
    
    return `
      <div class="log-entry ${log.level}">
        <div class="log-timestamp">${timeStr}</div>
        <div>
          <span class="log-level ${log.level}">${log.level}</span>
          <span class="log-message">${this.escapeHtml(log.message)}</span>
        </div>
        ${log.stack ? `
          <div class="log-details">
            <pre>${this.escapeHtml(log.stack)}</pre>
          </div>
        ` : ''}
        ${log.details ? `
          <div class="log-details">
            <pre>${JSON.stringify(log.details, null, 2)}</pre>
          </div>
        ` : ''}
      </div>
    `;
  }
  
  /**
   * Render logs
   */
  renderLogs() {
    const content = document.getElementById('logs-content');
    const count = document.getElementById('logs-count');
    
    if (content) {
      content.innerHTML = this.renderLogsHTML();
      // Auto-scroll to bottom
      content.scrollTop = content.scrollHeight;
    }
    
    if (count) {
      const filteredCount = this.filterLevel === 'all' 
        ? this.logs.length 
        : this.logs.filter(log => log.level === this.filterLevel).length;
      count.textContent = `${filteredCount} log${filteredCount !== 1 ? 's' : ''}`;
    }
  }
  
  /**
   * Clear all logs
   */
  clearLogs() {
    this.logs = [];
    this.saveLogs();
    this.renderLogs();
  }
  
  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Save logs to localStorage (for persistence)
   */
  saveLogs() {
    try {
      // Only save last 100 logs to avoid storage issues
      const logsToSave = this.logs.slice(-100);
      localStorage.setItem('app-logs', JSON.stringify(logsToSave));
    } catch (e) {
      // Ignore storage errors
      console.error('Failed to save logs:', e);
    }
  }
  
  /**
   * Load logs from localStorage
   */
  loadLogs() {
    try {
      const savedLogs = localStorage.getItem('app-logs');
      if (savedLogs) {
        this.logs = JSON.parse(savedLogs);
      }
    } catch (e) {
      console.error('Failed to load logs:', e);
      this.logs = [];
    }
  }
}

module.exports = LogsPanel;

