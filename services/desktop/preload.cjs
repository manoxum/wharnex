// This preload is attached to a window created with `sandbox: true`, where
// Electron replaces `require` with a limited polyfill that resolves only
// `electron` and a few Node builtins. Requiring a sibling file throws, the
// whole preload aborts, and `wharnessDesktop` is never exposed — which drops
// the trusted renderer into web-only mode with no window controls and no
// native ChatGPT surfaces. This file MUST therefore stay self-contained and
// MUST NOT import project modules, so it is exempt from the 200-line cap
// (see `SoT/CODE_QUALITY.md` §1).
const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload)

// A pane follows one agent view through a dedicated stream: it subscribes, gets
// its own MessagePort, and acknowledges each drawn frame before the next one is
// sent. A refused subscription (the surface is not this window's yet) retries.
let mirrorRequestSequence = 0
const mirrorPortWaiters = new Map()
ipcRenderer.on('wharness:mirror:port', (event, reply) => {
  const waiter = mirrorPortWaiters.get(reply?.requestId)
  if (!waiter) { for (const port of event.ports || []) port.close(); return }
  mirrorPortWaiters.delete(reply.requestId)
  waiter(reply?.ok ? event.ports?.[0] : undefined)
})
const subscribeMirror = (channel, request, onFrame) => {
  if (typeof onFrame !== 'function') return () => {}
  let active = true
  let port
  let retry
  const open = () => {
    if (!active) return
    const requestId = `mirror-${++mirrorRequestSequence}`
    mirrorPortWaiters.set(requestId, (granted) => {
      if (!active) { granted?.close(); return }
      if (!granted) { retry = setTimeout(open, 500); return }
      port = granted
      port.onmessage = (message) => {
        const frame = message.data || {}
        onFrame({ width: Number(frame.width) || 0, height: Number(frame.height) || 0, data: frame.data }, () => { if (active) port.postMessage('ready') })
      }
      port.addEventListener('close', () => { if (active) retry = setTimeout(open, 500) })
      port.start()
    })
    ipcRenderer.send(channel, { ...request, requestId })
  }
  open()
  return () => { active = false; clearTimeout(retry); port?.close() }
}

contextBridge.exposeInMainWorld('wharnessDesktop', Object.freeze({
  platform: process.platform,
  codex: Object.freeze({
    status: (projectPath) => invoke('wharnex:codex:native-status', { projectPath }),
    login: (projectPath) => invoke('wharnex:codex:native-login', { projectPath }),
    logout: (projectPath) => invoke('wharnex:codex:native-logout', { projectPath }),
    preparePrompt: (request) => invoke('wharnex:codex:prepare', request),
    prepareNative: (request) => invoke('wharnex:codex:native-prepare', request),
    answer: (projectPath, chatId, requestId, askId, response) => invoke('wharnex:codex:native-answer', { projectPath, chatId, requestId, askId, response }),
    cancelNativeRequest: (projectPath, chatId, requestId) => invoke('wharnex:codex:native-cancel', { projectPath, chatId, requestId }),
    resumeNative: (projectPath, chatId, requestId, text) => invoke('wharnex:codex:native-resume', { projectPath, chatId, requestId, text }),
    createAccount: (projectPath, label) => invoke('wharnex:codex:native-account-create', { projectPath, label }),
    selectAccount: (projectPath, accountId) => invoke('wharnex:codex:native-account-select', { projectPath, accountId }),
    threads: (projectPath) => invoke('wharnex:codex:threads', { projectPath }),
    history: (projectPath, chatId) => invoke('wharnex:codex:native-history', { projectPath, chatId }),
    cancelRequest: (projectPath, chatId, requestId) => invoke('wharnex:codex:cancel', { projectPath, chatId, requestId }),
    pendingBundles: (projectPath) => invoke('wharnex:codex:pending', { projectPath }),
    acknowledge: (projectPath, chatId, requestId) => invoke('wharnex:codex:acknowledge', { projectPath, chatId, requestId }),
    subscribe: (projectPath) => invoke('wharnex:codex:subscribe', { projectPath }),
    unsubscribe: (projectPath) => invoke('wharnex:codex:unsubscribe', { projectPath }),
    onAccountChange: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('wharnex:codex:account-changed', handler)
      return () => ipcRenderer.removeListener('wharnex:codex:account-changed', handler)
    },
    onEvent: (callback) => {
      const handler = (_event, payload) => { if (typeof callback === 'function') callback(payload) }
      ipcRenderer.on('wharnex:codex:event', handler)
      return () => ipcRenderer.removeListener('wharnex:codex:event', handler)
    },
    onBundle: (callback) => {
      const handler = (_event, payload) => { if (typeof callback === 'function') callback(payload) }
      ipcRenderer.on('wharnex:codex:bundle', handler)
      return () => ipcRenderer.removeListener('wharnex:codex:bundle', handler)
    },
  }),
  projects: Object.freeze({
    pickDirectory: (request = {}) => invoke('wharness:projects:pick-directory', request),
    pickImage: (request = {}) => invoke('wharness:projects:pick-image', request),
    trash: (projectPath) => invoke('wharness:projects:trash', { projectPath: String(projectPath || '') }),
    acquire: (projectPath) => invoke('wharness:projects:acquire', { projectPath: String(projectPath || '') }),
    release: (projectPath) => invoke('wharness:projects:release', { projectPath: String(projectPath || '') }),
    activate: (projectPath) => invoke('wharness:projects:activate', { projectPath: String(projectPath || '') }),
    bindings: () => invoke('wharness:projects:bindings'),
  }),
  windows: Object.freeze({
    info: () => invoke('wharness:windows:info'),
    recovery: () => invoke('wharness:windows:recovery'),
    projects: () => invoke('wharness:windows:projects'),
    focusProject: (projectPath) => invoke('wharness:windows:focus-project', { projectPath: String(projectPath || '') }),
    onActivateProject: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:windows:activate-project', handler)
      return () => ipcRenderer.removeListener('wharness:windows:activate-project', handler)
    },
    onCloseProject: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:windows:close-project', handler)
      return () => ipcRenderer.removeListener('wharness:windows:close-project', handler)
    },
    onCloseConfirmation: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:windows:confirm-close', handler)
      return () => ipcRenderer.removeListener('wharness:windows:confirm-close', handler)
    },
    acknowledgeClose: () => invoke('wharness:windows:acknowledge-close'),
    resolveClose: (action) => invoke('wharness:windows:resolve-close', { action: String(action || '') }),
    open: (request = {}) => invoke('wharness:windows:open', request),
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
  notifications: Object.freeze({
    publish: (request = {}) => invoke('wharness:notifications:publish', request),
    onOpen: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:notifications:open', handler)
      return () => ipcRenderer.removeListener('wharness:notifications:open', handler)
    },
  }),
  tray: Object.freeze({
    updateProjectState: (request = {}) => invoke('wharness:tray:update-project-state', request),
    onAction: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('wharness:tray:action', handler)
      return () => ipcRenderer.removeListener('wharness:tray:action', handler)
    },
  }),
  spellcheck: Object.freeze({
    showSuggestions: (point = {}) => invoke('wharness:spellcheck:show-suggestions', { x: Number(point?.x), y: Number(point?.y) }),
  }),
  chatgpt: Object.freeze({
    getChatGPTModels: (request) => invoke('wharnex:chatgpt:get-models', { workspaceChatId: String(request?.workspaceChatId || ''), url: String(request?.url || '') }),
    setChatGPTModel: (request) => invoke('wharnex:chatgpt:set-model', { workspaceChatId: String(request?.workspaceChatId || ''), model: String(request?.model || ''), url: String(request?.url || '') }),
    show: (bounds, cacheKey, url) => invoke('wharness:chatgpt:show', { bounds, cacheKey, url: String(url || '') }),
    hide: (cacheKey) => invoke('wharness:chatgpt:hide', { cacheKey }),
    setBounds: (bounds, cacheKey) => invoke('wharness:chatgpt:set-bounds', { bounds, cacheKey }),
    mirrorInput: (cacheKey, input) => invoke('wharness:chatgpt:mirror-input', { cacheKey, input }),
    subscribeMirror: (cacheKey, onFrame) => subscribeMirror('wharness:chatgpt:mirror-subscribe', { cacheKey: String(cacheKey || '') }, onFrame),
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
    copyPendingBundles: (cacheKey, requestId = '') => invoke('wharness:chatgpt:copy-pending-bundles', { cacheKey, requestId }),
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
    openMonitor: (agentId) => invoke('wharness:agents:monitor-open', { agentId: String(agentId || '') }),
    closeMonitor: (agentId) => invoke('wharness:agents:monitor-close', { agentId: String(agentId || '') }),
    openDevTools: (agentId) => invoke('wharness:agents:open-devtools', { agentId: String(agentId || '') }),
    openInteraction: (agentId, bounds) => invoke('wharness:agents:interaction-open', { agentId: String(agentId || ''), bounds }),
    setInteractionBounds: (agentId, bounds) => invoke('wharness:agents:interaction-bounds', { agentId: String(agentId || ''), bounds }),
    closeInteraction: (agentId) => invoke('wharness:agents:interaction-close', { agentId: String(agentId || '') }),
    presentInMonitor: (agentId, bounds) => invoke('wharness:agents:monitor-present', { agentId: String(agentId || ''), bounds }),
    resizeInMonitor: (agentId, bounds) => invoke('wharness:agents:monitor-bounds', { agentId: String(agentId || ''), bounds }),
    releaseFromMonitor: (agentId) => invoke('wharness:agents:monitor-release', { agentId: String(agentId || '') }),
    presentLinkInMonitor: (url, bounds) => invoke('wharness:agents:monitor-link-present', { url: String(url || ''), bounds }),
    resizeLinkInMonitor: (bounds) => invoke('wharness:agents:monitor-link-bounds', { bounds }),
    releaseLinkInMonitor: (url) => invoke('wharness:agents:monitor-link-release', { url: String(url || '') }),
    closeLinkInMonitor: (url) => invoke('wharness:agents:monitor-link-close', { url: String(url || '') }),
    mirrorInput: (agentId, input) => invoke('wharness:agents:mirror-input', { agentId: String(agentId || ''), input }),
    subscribeMirror: (agentId, onFrame) => subscribeMirror('wharness:agents:mirror-subscribe', { agentId: String(agentId || '') }, onFrame),
    onMonitorSelect: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, selection) => callback(selection)
      ipcRenderer.on('wharness:agents:monitor-select', handler)
      return () => ipcRenderer.removeListener('wharness:agents:monitor-select', handler)
    },
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
  uiTesting: Object.freeze({
    openGuide: (request) => invoke('wharnex:ui-testing:open-guide', {
      sessionId: String(request?.sessionId || ''), runId: String(request?.runId || ''), format: String(request?.format || ''),
    }),
  }),
  clipboard: Object.freeze({
    copyContextZip: (request) => invoke('wharness:clipboard:copy-context-zip', request),
    readText: () => invoke('wharness:clipboard:read-text'),
    writeText: (text) => invoke('wharness:clipboard:write-text', String(text)),
  }),
}))
