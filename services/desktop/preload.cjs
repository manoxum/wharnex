const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload)

contextBridge.exposeInMainWorld('wharnessDesktop', Object.freeze({
  platform: process.platform,
  chatgpt: Object.freeze({
    show: (bounds, cacheKey) => invoke('wharness:chatgpt:show', { bounds, cacheKey }),
    hide: () => invoke('wharness:chatgpt:hide'),
    setBounds: (bounds) => invoke('wharness:chatgpt:set-bounds', bounds),
    navigate: (url, cacheKey, options = {}) => invoke('wharness:chatgpt:navigate', { url: String(url), cacheKey, resetToHomeIfConversation: Boolean(options?.resetToHomeIfConversation) }),
    reload: () => invoke('wharness:chatgpt:reload'),
    focus: () => invoke('wharness:chatgpt:focus'),
    back: () => invoke('wharness:chatgpt:back'),
    forward: () => invoke('wharness:chatgpt:forward'),
    paste: () => invoke('wharness:chatgpt:paste'),
    submitPrompt: (request) => invoke('wharness:chatgpt:submit-prompt', request),
    preparePrompt: (request) => invoke('wharness:chatgpt:prepare-prompt', request),
    submitPrepared: (request) => invoke('wharness:chatgpt:submit-prepared', request),
    state: () => invoke('wharness:chatgpt:state'),
    openExternal: () => invoke('wharness:chatgpt:open-external'),
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
