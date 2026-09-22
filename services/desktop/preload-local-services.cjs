function createLocalServices(invoke) {
  return {
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
  }
}

module.exports = { createLocalServices }
