const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload)

contextBridge.exposeInMainWorld('wharnessDesktop', Object.freeze({
  platform: process.platform,
  projects: Object.freeze({
    pickDirectory: (request = {}) => invoke('wharness:projects:pick-directory', request),
  }),
  chatgpt: Object.freeze({
    show: (bounds, cacheKey) => invoke('wharness:chatgpt:show', { bounds, cacheKey }),
    hide: (cacheKey) => invoke('wharness:chatgpt:hide', { cacheKey }),
    setBounds: (bounds, cacheKey) => invoke('wharness:chatgpt:set-bounds', { bounds, cacheKey }),
    navigate: (url, cacheKey, options = {}) => invoke('wharness:chatgpt:navigate', { url: String(url), cacheKey, resetToHomeIfConversation: Boolean(options?.resetToHomeIfConversation) }),
    reload: (cacheKey) => invoke('wharness:chatgpt:reload', { cacheKey }),
    focus: (cacheKey) => invoke('wharness:chatgpt:focus', { cacheKey }),
    back: (cacheKey) => invoke('wharness:chatgpt:back', { cacheKey }),
    forward: (cacheKey) => invoke('wharness:chatgpt:forward', { cacheKey }),
    paste: (cacheKey) => invoke('wharness:chatgpt:paste', { cacheKey }),
    submitPrompt: (request) => invoke('wharness:chatgpt:submit-prompt', request),
    preparePrompt: (request) => invoke('wharness:chatgpt:prepare-prompt', request),
    attachContext: (request) => invoke('wharness:chatgpt:attach-context', request),
    attachPrompt: (request) => invoke('wharness:chatgpt:attach-prompt', request),
    submitPrepared: (request) => invoke('wharness:chatgpt:submit-prepared', request),
    queueComment: (request) => invoke('wharness:chatgpt:queue-comment', request),
    state: (cacheKey) => invoke('wharness:chatgpt:state', { cacheKey }),
    release: (cacheKey) => invoke('wharness:chatgpt:release', { cacheKey }),
    setAuthMode: (cacheKey, mode) => invoke('wharness:chatgpt:set-auth-mode', { cacheKey, mode }),
    startAuth: (cacheKey, mode) => invoke('wharness:chatgpt:start-auth', { cacheKey, mode }),
    openExternal: (url = '') => invoke('wharness:chatgpt:open-external', { url: String(url || '') }),
    resumeEmbedded: (cacheKey) => invoke('wharness:chatgpt:resume-embedded', { cacheKey }),
    pickBundle: (request) => invoke('wharness:chatgpt:pick-bundle', request),
    onState: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, state) => callback(state)
      ipcRenderer.on('wharness:chatgpt:state', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:state', handler)
    },
    onExternalAuth: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, state) => callback(state)
      ipcRenderer.on('wharness:chatgpt:external-auth', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:external-auth', handler)
    },
    onAuthComplete: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, state) => callback(state)
      ipcRenderer.on('wharness:chatgpt:auth-complete', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:auth-complete', handler)
    },
    onAuthError: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, state) => callback(state)
      ipcRenderer.on('wharness:chatgpt:auth-error', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:auth-error', handler)
    },
    onPlanDownloaded: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:chatgpt:plan-downloaded', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:plan-downloaded', handler)
    },
    onPlanDownloadError: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:chatgpt:plan-download-error', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:plan-download-error', handler)
    },
    onBundleDownloaded: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:chatgpt:bundle-downloaded', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:bundle-downloaded', handler)
    },
    onBundleDownloadError: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:chatgpt:bundle-download-error', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:bundle-download-error', handler)
    },
    onActivity: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:chatgpt:activity', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:activity', handler)
    },
    onCommentSent: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:chatgpt:comment-sent', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:comment-sent', handler)
    },
  }),
  data: Object.freeze({
    storage: () => invoke('wharness:data:storage'),
    exportBrowserSession: () => invoke('wharness:data:export-browser-session'),
    importBrowserSession: () => invoke('wharness:data:import-browser-session'),
    clearBrowserSession: () => invoke('wharness:data:clear-browser-session'),
    clearAll: (confirm) => invoke('wharness:data:clear-all', { confirm: String(confirm || '') }),
  }),
  attachments: Object.freeze({
    persist: (request) => invoke('wharness:attachments:persist', request),
    preview: (request) => invoke('wharness:attachments:preview', request),
    open: (request) => invoke('wharness:attachments:open', request),
    removeChat: (request) => invoke('wharness:attachments:remove-chat', request),
  }),
  clipboard: Object.freeze({
    copyContextZip: (request) => invoke('wharness:clipboard:copy-context-zip', request),
    readText: () => invoke('wharness:clipboard:read-text'),
    writeText: (text) => invoke('wharness:clipboard:write-text', String(text)),
  }),
}))
