export function registerBundleDeliveryIPC({
  ipcMain, trustedSender, pendingChatGPTBundlePayloads,
  acknowledgeChatGPTBundle, pendingChatGPTBundleDeliveries,
  sanitizeChatCacheKey,
}) {
  ipcMain.handle('wharness:chatgpt:pending-bundles', async (event) => { trustedSender(event); return pendingChatGPTBundlePayloads() })
  ipcMain.handle('wharness:chatgpt:ack-bundle', async (event, request) => { trustedSender(event); return acknowledgeChatGPTBundle(request?.cacheKey, request?.requestId, request?.filename) })
  ipcMain.handle('wharness:chatgpt:nack-bundle', async (event, request) => {
    trustedSender(event)
    const id = String(request?.requestId || '').trim()
    const record = pendingChatGPTBundleDeliveries.get(id)
    if (record && request?.cacheKey) record.cacheKey = sanitizeChatCacheKey(request.cacheKey)
    return { ok: true, requestId: id, retained: Boolean(record) }
  })
}
