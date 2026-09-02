const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload)

contextBridge.exposeInMainWorld('wharnessDesktop', Object.freeze({
  platform: process.platform,
  chatgpt: Object.freeze({
    show: (bounds) => invoke('wharness:chatgpt:show', bounds),
    hide: () => invoke('wharness:chatgpt:hide'),
    setBounds: (bounds) => invoke('wharness:chatgpt:set-bounds', bounds),
    navigate: (url) => invoke('wharness:chatgpt:navigate', String(url)),
    reload: () => invoke('wharness:chatgpt:reload'),
    focus: () => invoke('wharness:chatgpt:focus'),
    back: () => invoke('wharness:chatgpt:back'),
    forward: () => invoke('wharness:chatgpt:forward'),
    paste: () => invoke('wharness:chatgpt:paste'),
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
  }),
  clipboard: Object.freeze({
    copyContextZip: (request) => invoke('wharness:clipboard:copy-context-zip', request),
    readText: () => invoke('wharness:clipboard:read-text'),
    writeText: (text) => invoke('wharness:clipboard:write-text', String(text)),
  }),
}))
