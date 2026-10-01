export function createPendingBundleInbox({
  app, path, readdir, readFile, rm, requestIdFromFilename, recentlyDelivered,
  validateBundle, deliveries, sanitizeChatCacheKey, markDelivered,
  cancelRequest, scheduler, parseBundleName, safeChatId, enqueueTask,
  retentionMs,
}) {
  function pendingBundleDirectory() {
    // Durable request state belongs to this Desktop instance's userData.
    return path.join(app.getPath('userData'), 'pending-chatgpt-bundles-v1')
  }

  async function pendingChatGPTBundlePayloads() {
    const payloads = []
    let names = []
    try { names = await readdir(pendingBundleDirectory()) } catch { return payloads }
    for (const name of names) {
      if (!name.endsWith('.zip')) continue
      const requestId = requestIdFromFilename(name)
      if (!requestId || recentlyDelivered(requestId)) continue
      const filePath = path.join(pendingBundleDirectory(), path.basename(name))
      try {
        const bytes = await readFile(filePath)
        validateBundle(name, bytes)
        const remembered = deliveries.get(requestId)
        payloads.push({ cacheKey: remembered?.cacheKey || '', filename: name, requestId, contentBase64: bytes.toString('base64'), bytes: bytes.byteLength, recovered: true })
        deliveries.set(requestId, { cacheKey: remembered?.cacheKey || '', filename: name, filePath })
      } catch { /* invalid/incomplete downloads are never replayed */ }
    }
    return payloads
  }

  async function acknowledgeChatGPTBundle(cacheKey, requestId, filename) {
    const key = cacheKey ? sanitizeChatCacheKey(cacheKey) : ''
    const id = String(requestId || '').trim()
    const record = deliveries.get(id)
    if (record && filename && path.basename(filename) !== record.filename) throw new Error('Bundle acknowledgement filename mismatch')
    markDelivered(id)
    if (record) {
      deliveries.delete(id)
      try { await rm(record.filePath, { force: true }) } catch { /* acknowledged data is safe to clean later */ }
    }
    if (key) await cancelRequest(key, id)
    if (record?.filename && key && scheduler()) {
      const parsed = parseBundleName(record.filename)
      if (parsed?.kind === 'res' && parsed?.chatId === safeChatId(key)) {
        await enqueueTask('DELETE_BUNDLE', {
          key,
          requestId: id,
          rootRequestId: id,
          conversationURL: '',
          dedupeKey: `delete-bundle:${record.filename}`,
          notBefore: new Date(Date.now() + retentionMs).toISOString(),
          payload: { canonical_filename: record.filename, artifact_id: '', locally_persisted: true },
          maxAttempts: 8,
        }).catch((error) => console.warn(`[chat-agent] remote bundle cleanup enqueue failed request=${id}: ${error instanceof Error ? error.message : String(error)}`))
      }
    }
    return { ok: true, requestId: id, alreadyAcknowledged: !record }
  }

  return { pendingBundleDirectory, pendingChatGPTBundlePayloads, acknowledgeChatGPTBundle }
}
