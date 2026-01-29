/**
 * Authentication Modal
 * Handles password setup and verification
 */

class AuthModal {
  constructor() {
    this.modal = null;
    this.setupMode = false;
    this.onSuccess = null;
  }
  
  /**
   * Show authentication modal
   * @param {boolean} isSetup - True if setting up password for first time
   * @param {Function} onSuccess - Callback on successful auth
   */
  async show(isSetup = false, onSuccess = null) {
    this.setupMode = isSetup;
    this.onSuccess = onSuccess;
    
    // Create modal HTML
    const modalHTML = `
      <div id="auth-modal" class="auth-modal-overlay">
        <div class="auth-modal-content">
          <h2>${isSetup ? 'Setup Master Password' : 'Enter Master Password'}</h2>
          <p class="auth-modal-description">
            ${isSetup 
              ? 'Create a master password to encrypt your chat data. This password cannot be recovered.'
              : 'Enter your master password to unlock the application.'}
          </p>
          <form id="auth-form">
            <div class="auth-input-group">
              <label for="password-input">Password</label>
              <input 
                type="password" 
                id="password-input" 
                autocomplete="off"
                placeholder="${isSetup ? 'Minimum 12 characters' : 'Enter password'}"
                required
                minlength="${isSetup ? 12 : 1}"
              />
              <div id="password-strength" class="password-strength" style="display: ${isSetup ? 'block' : 'none'}"></div>
            </div>
            ${isSetup ? `
              <div class="auth-input-group">
                <label for="password-confirm">Confirm Password</label>
                <input 
                  type="password" 
                  id="password-confirm" 
                  autocomplete="off"
                  placeholder="Confirm password"
                  required
                />
              </div>
            ` : ''}
            <div id="auth-error" class="auth-error" style="display: none;"></div>
            <button type="submit" id="auth-submit" class="auth-submit-btn">
              ${isSetup ? 'Setup Password' : 'Unlock'}
            </button>
          </form>
        </div>
      </div>
    `;
    
    // Insert modal
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('auth-modal');
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Focus password input
    document.getElementById('password-input').focus();
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    const form = document.getElementById('auth-form');
    const passwordInput = document.getElementById('password-input');
    const passwordConfirm = document.getElementById('password-confirm');
    
    // Password strength indicator (setup mode)
    if (this.setupMode) {
      passwordInput.addEventListener('input', () => {
        this.updatePasswordStrength(passwordInput.value);
      });
      
      passwordConfirm.addEventListener('input', () => {
        this.validatePasswordMatch();
      });
    }
    
    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSubmit();
    });
    
    // Prevent autocomplete
    passwordInput.setAttribute('autocomplete', 'new-password');
    if (passwordConfirm) {
      passwordConfirm.setAttribute('autocomplete', 'new-password');
    }
  }
  
  /**
   * Update password strength indicator
   */
  updatePasswordStrength(password) {
    const strengthDiv = document.getElementById('password-strength');
    if (!strengthDiv) return;
    
    const strength = this.calculatePasswordStrength(password);
    strengthDiv.textContent = strength.text;
    strengthDiv.className = `password-strength ${strength.class}`;
  }
  
  /**
   * Calculate password strength
   */
  calculatePasswordStrength(password) {
    if (password.length < 8) {
      return { text: 'Too short (minimum 8 characters)', class: 'weak' };
    }
    if (password.length < 12) {
      return { text: 'Weak (recommend 12+ characters)', class: 'weak' };
    }
    
    let score = 0;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    
    if (password.length >= 16) score++;
    
    if (score <= 2) {
      return { text: 'Weak', class: 'weak' };
    } else if (score <= 3) {
      return { text: 'Medium', class: 'medium' };
    } else {
      return { text: 'Strong', class: 'strong' };
    }
  }
  
  /**
   * Validate password match
   */
  validatePasswordMatch() {
    const password = document.getElementById('password-input').value;
    const confirm = document.getElementById('password-confirm').value;
    const errorDiv = document.getElementById('auth-error');
    
    if (confirm && password !== confirm) {
      errorDiv.textContent = 'Passwords do not match';
      errorDiv.style.display = 'block';
      return false;
    } else {
      errorDiv.style.display = 'none';
      return true;
    }
  }
  
  /**
   * Handle form submission
   */
  async handleSubmit() {
    const password = document.getElementById('password-input').value;
    const passwordConfirm = this.setupMode 
      ? document.getElementById('password-confirm').value 
      : password;
    const errorDiv = document.getElementById('auth-error');
    const submitBtn = document.getElementById('auth-submit');
    
    // Validate
    if (this.setupMode && password !== passwordConfirm) {
      errorDiv.textContent = 'Passwords do not match';
      errorDiv.style.display = 'block';
      return;
    }
    
    if (this.setupMode && password.length < 12) {
      errorDiv.textContent = 'Password must be at least 12 characters';
      errorDiv.style.display = 'block';
      return;
    }
    
    // Disable submit button
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';
    errorDiv.style.display = 'none';
    
    try {
      let result;
      
      if (this.setupMode) {
        result = await window.electronAPI.setupPassword(password);
      } else {
        result = await window.electronAPI.verifyPassword(password);
      }
      
      if (result.success) {
        // Success - close modal and call callback
        this.hide();
        if (this.onSuccess) {
          this.onSuccess();
        }
      } else {
        // Error
        errorDiv.textContent = result.error || 'Authentication failed';
        errorDiv.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = this.setupMode ? 'Setup Password' : 'Unlock';
      }
    } catch (error) {
      errorDiv.textContent = `Error: ${error.message}`;
      errorDiv.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = this.setupMode ? 'Setup Password' : 'Unlock';
    }
    
    // Clear password fields (best-effort security)
    document.getElementById('password-input').value = '';
    if (this.setupMode && document.getElementById('password-confirm')) {
      document.getElementById('password-confirm').value = '';
    }
  }
  
  /**
   * Hide modal
   */
  hide() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }
}

// Export for browser use (ES module or global)
if (typeof window !== 'undefined') {
  window.AuthModal = AuthModal;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthModal;
}

