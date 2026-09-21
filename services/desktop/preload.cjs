const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload)

contextBridge.exposeInMainWorld('wharnessDesktop', Object.freeze({
  platform: process.platform,
  projects: Object.freeze({
    pickDirectory: (request = {}) => invoke('wharness:projects:pick-directory', request),
    acquire: (projectPath) => invoke('wharness:projects:acquire', { projectPath: String(projectPath || '') }),
    release: (projectPath) => invoke('wharness:projects:release', { projectPath: String(projectPath || '') }),
    activate: (projectPath) => invoke('wharness:projects:activate', { projectPath: String(projectPath || '') }),
    bindings: () => invoke('wharness:projects:bindings'),
  }),
  windows: Object.freeze({
    info: () => invoke('wharness:windows:info'),
    projects: () => invoke('wharness:windows:projects'),
    focusProject: (projectPath) => invoke('wharness:windows:focus-project', { projectPath: String(projectPath || '') }),
    onActivateProject: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:windows:activate-project', handler)
      return () => ipcRenderer.removeListener('wharness:windows:activate-project', handler)
    },
    open: () => invoke('wharness:windows:open'),
    openSurface: (request = {}) => invoke('wharness:windows:open-surface', request),
    moveSurface: (request = {}) => invoke('wharness:windows:move-surface', request),
    onSurfaceReceived: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:windows:receive-surface', handler)
      return () => ipcRenderer.removeListener('wharness:windows:receive-surface', handler)
    },
    minimize: () => invoke('wharness:windows:minimize'),
    toggleMaximize: () => invoke('wharness:windows:toggle-maximize'),
    close: () => invoke('wharness:windows:close'),
    activateSelfEvolution: (impacts) => invoke('wharness:windows:activate-self-evolution', { impacts }),
  }),
  spellcheck: Object.freeze({
    showSuggestions: (point = {}) => invoke('wharness:spellcheck:show-suggestions', { x: Number(point?.x), y: Number(point?.y) }),
  }),
  chatgpt: Object.freeze({
    show: (bounds, cacheKey, url) => invoke('wharness:chatgpt:show', { bounds, cacheKey, url: String(url || '') }),
    hide: (cacheKey) => invoke('wharness:chatgpt:hide', { cacheKey }),
    setBounds: (bounds, cacheKey) => invoke('wharness:chatgpt:set-bounds', { bounds, cacheKey }),
    navigate: (url, cacheKey, options = {}) => invoke('wharness:chatgpt:navigate', { url: String(url), cacheKey, resetToHomeIfConversation: Boolean(options?.resetToHomeIfConversation), bounds: options?.bounds }),
    confirmAffinity: (cacheKey, conversationUrl) => invoke('wharness:chatgpt:confirm-affinity', { cacheKey, conversationUrl: String(conversationUrl || '') }),
    rejectAffinity: (cacheKey, conversationUrl) => invoke('wharness:chatgpt:reject-affinity', { cacheKey, conversationUrl: String(conversationUrl || '') }),
    reload: (cacheKey) => invoke('wharness:chatgpt:reload', { cacheKey }),
    back: (cacheKey) => invoke('wharness:chatgpt:back', { cacheKey }),
    forward: (cacheKey) => invoke('wharness:chatgpt:forward', { cacheKey }),
    paste: (cacheKey) => invoke('wharness:chatgpt:paste', { cacheKey }),
    openDevTools: (cacheKey) => invoke('wharness:chatgpt:open-devtools', { cacheKey }),
    submitPrompt: (request) => invoke('wharness:chatgpt:submit-prompt', request),
    preparePrompt: (request) => invoke('wharness:chatgpt:prepare-prompt', request),
    retryPreparedPrompt: (request) => invoke('wharness:chatgpt:retry-prepared-prompt', request),
    attachContext: (request) => invoke('wharness:chatgpt:attach-context', request),
    attachPrompt: (request) => invoke('wharness:chatgpt:attach-prompt', request),
    submitPrepared: (request) => invoke('wharness:chatgpt:submit-prepared', request),
    queueComment: (request) => invoke('wharness:chatgpt:queue-comment', request),
    state: (cacheKey) => invoke('wharness:chatgpt:state', { cacheKey }),
    release: (cacheKey) => invoke('wharness:chatgpt:release', { cacheKey }),
    liveKeys: () => invoke('wharness:chatgpt:live-keys', {}),
    queueArchive: (request) => invoke('wharness:chatgpt:queue-archive', request),
    stopConversation: (cacheKey) => invoke('wharness:chatgpt:stop-conversation', { cacheKey }),
    cancelRequest: (cacheKey, requestId) => invoke('wharness:chatgpt:cancel-request', { cacheKey, requestId }),
    queueRename: (request) => invoke('wharness:chatgpt:queue-rename', request),
    queueDelete: (request) => invoke('wharness:chatgpt:queue-delete', request),
    suggestTitle: (cacheKey, url = '') => invoke('wharness:chatgpt:suggest-title', { cacheKey, url: String(url || '') }),
    hideSidebar: (cacheKey) => invoke('wharness:chatgpt:hide-sidebar', { cacheKey }),
    // Dev-only behavior probe (adr/ADR-0041): `control` is matched against a
    // closed enum in the main process and never reaches the page as a string.
    probeBehavior: (cacheKey, control) => invoke('wharness:chatgpt:probe-behavior', { cacheKey, control: String(control || '') }),
    probeBehaviorControls: () => invoke('wharness:chatgpt:probe-behavior-controls', {}),
    setAuthMode: (cacheKey, mode) => invoke('wharness:chatgpt:set-auth-mode', { cacheKey, mode }),
    setTransportMode: (cacheKey, mode) => invoke('wharness:chatgpt:set-transport-mode', { cacheKey, mode }),
    startAuth: (cacheKey, mode) => invoke('wharness:chatgpt:start-auth', { cacheKey, mode }),
    openExternal: (url = '') => invoke('wharness:chatgpt:open-external', { url: String(url || '') }),
    openInternal: (url = '') => invoke('wharness:chatgpt:open-internal', { url: String(url || '') }),
    resumeEmbedded: (cacheKey) => invoke('wharness:chatgpt:resume-embedded', { cacheKey }),
    resumeExpectedBundle: (request) => invoke('wharness:chatgpt:resume-expected-bundle', request),
    continueExpectedBundle: (cacheKey, requestId, options = {}) => invoke('wharness:chatgpt:continue-expected-bundle', { cacheKey, requestId, force: Boolean(options?.force) }),
    pickBundle: (request) => invoke('wharness:chatgpt:pick-bundle', request),
    pendingBundles: () => invoke('wharness:chatgpt:pending-bundles'),
    ackBundle: (cacheKey, requestId, filename) => invoke('wharness:chatgpt:ack-bundle', { cacheKey, requestId, filename }),
    nackBundle: (cacheKey, requestId, filename) => invoke('wharness:chatgpt:nack-bundle', { cacheKey, requestId, filename }),
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
    onHumanAction: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:chatgpt:human-action', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:human-action', handler)
    },
    onAccountAction: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:chatgpt:account-action', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:account-action', handler)
    },
    onCommentSent: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:chatgpt:comment-sent', handler)
      return () => ipcRenderer.removeListener('wharness:chatgpt:comment-sent', handler)
    },
  }),
  agents: Object.freeze({
    state: () => invoke('wharness:agents:state'),
    setSupervisorCount: (count) => invoke('wharness:agents:set-supervisor-count', { count: Number(count) }),
    setWorkerCount: (count) => invoke('wharness:agents:set-worker-count', { count: Number(count) }),
    setPolicies: (policies) => invoke('wharness:agents:set-policies', policies || {}),
    setWorkerKeepFlowing: (agentId, enabled) => invoke('wharness:agents:set-worker-keep-flowing', { agentId: String(agentId || ''), enabled: enabled === true }),
    pauseWorkers: (pausedUntil, taskTypes = []) => invoke('wharness:agents:pause-workers', {
      pausedUntil: String(pausedUntil || ''),
      taskTypes: Array.isArray(taskTypes) ? taskTypes.map((value) => String(value || '')) : [],
    }),
    resumeWorkers: () => invoke('wharness:agents:resume-workers'),
    pauseProvider: (pausedUntil) => invoke('wharness:agents:pause-provider', { pausedUntil: String(pausedUntil || '') }),
    resumeProvider: () => invoke('wharness:agents:resume-provider'),
    snapshot: (agentId) => invoke('wharness:agents:snapshot', { agentId: String(agentId || '') }),
    openDevTools: (agentId) => invoke('wharness:agents:open-devtools', { agentId: String(agentId || '') }),
    openInteraction: (agentId, bounds) => invoke('wharness:agents:interaction-open', { agentId: String(agentId || ''), bounds }),
    setInteractionBounds: (agentId, bounds) => invoke('wharness:agents:interaction-bounds', { agentId: String(agentId || ''), bounds }),
    closeInteraction: (agentId) => invoke('wharness:agents:interaction-close', { agentId: String(agentId || '') }),
    onState: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, state) => callback(state)
      ipcRenderer.on('wharness:agents:state', handler)
      return () => ipcRenderer.removeListener('wharness:agents:state', handler)
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
    read: (request) => invoke('wharness:attachments:read', request),
    open: (request) => invoke('wharness:attachments:open', request),
    removeChat: (request) => invoke('wharness:attachments:remove-chat', request),
  }),
  clipboard: Object.freeze({
    copyContextZip: (request) => invoke('wharness:clipboard:copy-context-zip', request),
    readText: () => invoke('wharness:clipboard:read-text'),
    writeText: (text) => invoke('wharness:clipboard:write-text', String(text)),
  }),
}))
