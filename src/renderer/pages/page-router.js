/**
 * Page Router
 * Manages navigation between different views/pages in the application
 */

class PageRouter {
  constructor() {
    this.currentPage = 'chat';
    this.pages = {
      chat: {
        id: 'chat',
        container: '#chat-container',
        bodyClass: null,
        init: null // Will be set by page modules
      },
      browser: {
        id: 'browser',
        container: '#browser-view',
        bodyClass: 'browser-open',
        init: null
      },
      desktopApps: {
        id: 'desktopApps',
        container: '#desktop-apps-view',
        bodyClass: 'desktop-apps-open',
        init: null
      }
    };
  }

  /**
   * Register a page module
   * @param {string} pageId - Page identifier
   * @param {Function} initFn - Initialization function
   */
  registerPage(pageId, initFn) {
    if (this.pages[pageId]) {
      this.pages[pageId].init = initFn;
    }
  }

  /**
   * Navigate to a page
   * @param {string} pageId - Page identifier
   * @param {Object} options - Navigation options
   */
  navigateTo(pageId, options = {}) {
    if (!this.pages[pageId]) {
      console.error(`Page "${pageId}" not found`);
      return;
    }

    const targetPage = this.pages[pageId];
    const currentPageObj = this.pages[this.currentPage];

    // Hide current page
    if (currentPageObj) {
      const currentContainer = document.querySelector(currentPageObj.container);
      if (currentContainer) {
        currentContainer.style.display = 'none';
      }
      if (currentPageObj.bodyClass) {
        document.body.classList.remove(currentPageObj.bodyClass);
      }
    }

    // Show target page
    const targetContainer = document.querySelector(targetPage.container);
    if (targetContainer) {
      targetContainer.style.display = targetPage.container.includes('chat') ? 'flex' : 'flex';
    }
    if (targetPage.bodyClass) {
      document.body.classList.add(targetPage.bodyClass);
    }

    // Update current page
    this.currentPage = pageId;

    // Initialize page if needed
    if (targetPage.init && typeof targetPage.init === 'function') {
      targetPage.init(options);
    }

    console.log(`Navigated to page: ${pageId}`);
  }

  /**
   * Get current page
   */
  getCurrentPage() {
    return this.currentPage;
  }

  /**
   * Check if a page is active
   */
  isPageActive(pageId) {
    return this.currentPage === pageId;
  }
}

// Create global instance
window.pageRouter = new PageRouter();

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageRouter;
}
