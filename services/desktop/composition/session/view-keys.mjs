export function createChatGPTViewKeys({ chatgptViews, chatGPTWorkerEntries }) {
  function chatGPTKeyForEntry(entry) {
    const key = String(entry?.ownerKey || '')
    if (!key) return ''
    if (entry?.role === 'worker') return chatGPTWorkerEntries.includes(entry) ? key : ''
    return chatgptViews.get(key) === entry ? key : ''
  }

  function chatGPTKeyForWebContents(webContents) {
    if (!webContents || webContents.isDestroyed?.()) return ''
    for (const [key, entry] of chatgptViews) if (entry.view.webContents.id === webContents.id && entry.ownerKey === key) return key
    const worker = chatGPTWorkerEntries.find((entry) => entry.view.webContents.id === webContents.id && entry.ownerKey)
    return worker?.ownerKey || ''
  }

  function touchChatGPTEntry(entry) {
    entry.lastUsed = Date.now()
  }

  return { chatGPTKeyForEntry, chatGPTKeyForWebContents, touchChatGPTEntry }
}
