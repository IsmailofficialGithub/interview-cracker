/**
 * GitHub Service
 * Handles interaction with GitHub API for fetching file structures and code
 */

class GithubService {
  constructor() {
    this.baseUrl = 'https://api.github.com';
    this.rawUrl = 'https://raw.githubusercontent.com';
  }

  /**
   * Parse GitHub URL into owner, repo, and branch
   * @param {string} url - GitHub URL (e.g. https://github.com/owner/repo or https://github.com/owner)
   * @returns {Object|null} - { owner, repo, branch, isProfile: boolean } or null
   */
  parseUrl(url) {
    if (!url) return null;
    try {
      // Remove trailing slash if exists
      const cleanUrl = url.replace(/\/$/, '');
      
      // Pattern 1: Repository URL
      const repoPattern = /github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+))?/;
      const repoMatch = cleanUrl.match(repoPattern);
      
      if (repoMatch) {
        return {
          owner: repoMatch[1],
          repo: repoMatch[2],
          branch: repoMatch[3] || 'main',
          isProfile: false
        };
      }

      // Pattern 2: Profile URL (e.g. https://github.com/username)
      const profilePattern = /github\.com\/([^/]+)$/;
      const profileMatch = cleanUrl.match(profilePattern);
      if (profileMatch) {
        return {
          owner: profileMatch[1],
          isProfile: true
        };
      }
    } catch (error) {
      console.error('Failed to parse GitHub URL:', error);
    }
    return null;
  }

  /**
   * Fetch recursive file tree for a repository OR repo list for a profile
   * @param {string} url - GitHub repository or profile URL
   * @returns {Promise<Object|null>} - { type: 'tree'|'repos', data: Array }
   */
  async fetchFileTree(url) {
    const info = this.parseUrl(url);
    if (!info) return null;

    if (info.isProfile) {
      return await this.fetchUserRepos(info.owner);
    }

    try {
      // Step 1: Get the SHA for the branch/default branch
      const refUrl = `${this.baseUrl}/repos/${info.owner}/${info.repo}/git/refs/heads/${info.branch}`;
      let response = await fetch(refUrl);
      
      // If branch not found, try 'master' as fallback
      if (response.status === 404 && info.branch === 'main') {
        info.branch = 'master';
        response = await fetch(`${this.baseUrl}/repos/${info.owner}/${info.repo}/git/refs/heads/master`);
      }

      if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
      
      const refData = await response.json();
      const treeSha = refData.object.sha;

      // Step 2: Get recursive tree
      const treeUrl = `${this.baseUrl}/repos/${info.owner}/${info.repo}/git/trees/${treeSha}?recursive=1`;
      const treeResponse = await fetch(treeUrl);
      if (!treeResponse.ok) throw new Error(`Failed to fetch tree: ${treeResponse.status}`);
      
      const treeData = await treeResponse.json();
      
      // Return only file paths (excluding directories)
      return {
        type: 'tree',
        owner: info.owner,
        repo: info.repo,
        branch: info.branch,
        data: treeData.tree
          .filter(item => item.type === 'blob')
          .map(item => item.path)
      };
    } catch (error) {
      console.error('GitHub fetch failed:', error);
      return null;
    }
  }

  /**
   * Fetch user repositories
   * @param {string} username - GitHub username
   * @returns {Promise<Object|null>} - { type: 'repos', data: Array }
   */
  async fetchUserRepos(username) {
    try {
      const url = `${this.baseUrl}/users/${username}/repos?sort=updated&per_page=20`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch repos: ${response.status}`);
      const repos = await response.json();
      
      return {
        type: 'repos',
        owner: username,
        data: repos.map(r => ({
          name: r.name,
          description: r.description || 'No description',
          language: r.language
        }))
      };
    } catch (error) {
      console.error('Failed to fetch user repos:', error);
      return null;
    }
  }

  /**
   * Fetch raw content of a file
   * @param {string} repoUrl - GitHub repository URL
   * @param {string} filePath - Path to the file in the repo
   * @returns {Promise<string|null>} - File content
   */
  async fetchFileContent(repoUrl, filePath) {
    const info = this.parseUrl(repoUrl);
    if (!info || !filePath) return null;

    try {
      const url = `${this.rawUrl}/${info.owner}/${info.repo}/${info.branch}/${filePath}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
      return await response.text();
    } catch (error) {
      console.error('Failed to fetch file content:', error);
      return null;
    }
  }

  /**
   * Perform fuzzy search for file paths
   * @param {Array<string>} tree - List of file paths
   * @param {string} query - Search query
   * @returns {Array<string>} - Top matching paths
   */
  fuzzySearch(tree, query) {
    if (!tree || !query || typeof Fuse === 'undefined') return [];
    
    const fuse = new Fuse(tree, {
      threshold: 0.4,
      distance: 100,
      includeScore: true
    });
    
    const results = fuse.search(query);
    return results.slice(0, 20).map(r => r.item);
  }
}

// In Electron/Renderer setup, we might need to export this or attach to window
if (typeof module !== 'undefined') {
  module.exports = GithubService;
} else {
  window.GithubService = GithubService;
}
