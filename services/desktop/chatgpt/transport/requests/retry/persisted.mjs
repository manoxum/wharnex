export function createPersistedPromptRetry(context) {
  const {
    sanitizeChatCacheKey,
    sanitizeSessionId,
    requireAutoSession,
    BACKEND_URL,
    fetch,
    chatInputArchiveFilename,
    authoritativeBundleFilename,
    canonicalChatGPTConversationURL,
    path,
    app,
    rm,
    mkdir,
    MAX_CONTEXT_BYTES,
    writeFile,
    chatInputPartManifest,
    targetChatGPTComposer,
    normalizeChatGPTReasoningEffort,
    localChatInputBootstrap,
    executeChatGPTDOMScript,
    chatGPTFillComposerScript,
    pasteChatGPTFile,
    wait,
    chatInputSettleDelay,
    chatGPTAssistantTurnCount,
    armExpectedChatGPTBundle,
    submitChatGPTDraft,
    disarmExpectedChatGPTBundle,
    clearChatGPTHumanAction,
  } = context

  async function retryPersistedChatGPTPrompt(request, entryOverride = undefined) {
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const requestId = String(request?.expectedRequestId || '').trim()
    const sessionId = sanitizeSessionId(request?.sessionId)
    await requireAutoSession(sessionId)
    const listingURL = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`, BACKEND_URL)
    const listingResponse = await fetch(listingURL, { redirect: 'error' })
    if (!listingResponse.ok) throw new Error(`Não foi possível consultar a entrada persistida (HTTP ${listingResponse.status}).`)
    const listing = await listingResponse.json()
    const canonicalName = chatInputArchiveFilename(key, requestId)
    const stem = canonicalName.replace(/\.zip$/i, '')
    const partPattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_part-(\\d+)-of-(\\d+)\\.zip$`, 'i')
    const rank = (name) => {
      if (name === canonicalName) return 1
      const match = partPattern.exec(name)
      return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
    }
    const latestByName = new Map()
    for (const item of listing?.artifacts || []) {
      const name = String(item?.name || '')
      if (item?.request_id !== requestId || item?.direction !== 'input' || item?.kind !== 'bundle' || (name !== canonicalName && !partPattern.test(name))) continue
      // Artifact listings are newest-first. Keep only the newest persisted copy
      // of each transport filename so a previous failed preparation cannot make
      // a durable retry upload the same part twice.
      if (!latestByName.has(name)) latestByName.set(name, item)
    }
    const artifacts = [...latestByName.values()].sort((a, b) => rank(String(a.name || '')) - rank(String(b.name || '')))
    if (!artifacts.length || artifacts[0]?.name !== canonicalName) throw new Error('A entrada completa deste pedido não está persistida; recrie o pedido para obter uma nova base segura.')
    const expectedFilename = authoritativeBundleFilename(request?.expectedFilename, requestId, key)
    const targetURL = canonicalChatGPTConversationURL(request?.url || '')
    if (!targetURL) throw new Error('O pedido pendente não possui uma conversa ChatGPT vinculada para reenvio seguro.')
    const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', key, 'durable-retry')
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const files = []
    let totalBytes = 0
    let multipartManifest
    const partManifests = []
    for (const artifact of artifacts) {
      const artifactURL = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifact.id)}`, BACKEND_URL)
      const artifactResponse = await fetch(artifactURL, { redirect: 'error' })
      if (!artifactResponse.ok) throw new Error(`Não foi possível recuperar a entrada persistida (HTTP ${artifactResponse.status}).`)
      const bytes = Buffer.from(await artifactResponse.arrayBuffer())
      if (!bytes.length || bytes.length > MAX_CONTEXT_BYTES) throw new Error('Uma parte da entrada persistida tem tamanho inválido.')
      const name = path.basename(String(artifact.name || ''))
      const filePath = path.join(dir, name)
      await writeFile(filePath, bytes, { mode: 0o600 })
      const partManifest = chatInputPartManifest(bytes)
      files.push({ name, path: filePath, bytes: bytes.byteLength })
      partManifests.push(partManifest)
      totalBytes += bytes.byteLength
      if (name === canonicalName) multipartManifest = partManifest
    }
    if (multipartManifest) {
      const expectedParts = Number(multipartManifest.part_count || 0)
      const payloadName = String(multipartManifest.payload_name || '')
      const payloadSha256 = String(multipartManifest.payload_sha256 || '')
      const payloadBytes = Number(multipartManifest.payload_bytes || 0)
      if (expectedParts !== files.length) throw new Error('O conjunto multipart persistido está incompleto; recrie o pedido para obter uma nova base segura.')
      for (let index = 0; index < files.length; index += 1) {
        const manifest = partManifests[index]
        if (!manifest || Number(manifest.part_index || 0) !== index + 1 || Number(manifest.part_count || 0) !== expectedParts || String(manifest.payload_name || '') !== payloadName || String(manifest.payload_sha256 || '') !== payloadSha256 || Number(manifest.payload_bytes || 0) !== payloadBytes) {
          throw new Error('O conjunto multipart persistido não é consistente; recrie o pedido para obter uma nova base segura.')
        }
      }
    } else if (files.length !== 1 || partManifests.some(Boolean)) {
      throw new Error('O conjunto persistido mistura transportes incompatíveis; recrie o pedido para obter uma nova base segura.')
    }
    const multipart = multipartManifest ? {
      protocol: 'wharness.chat-input-part/v1', payload_name: multipartManifest.payload_name,
      payload_bytes: multipartManifest.payload_bytes, payload_sha256: multipartManifest.payload_sha256,
      parts: files.map((file, index) => ({ name: file.name, index: index + 1, count: files.length })),
    } : undefined
    const target = await targetChatGPTComposer(key, targetURL, false, entryOverride)
    target.reasoningEffort = normalizeChatGPTReasoningEffort(request?.reasoningEffort)
    target.entry.reasoningEffort = target.reasoningEffort
    const bootstrap = localChatInputBootstrap(requestId, canonicalName, expectedFilename, [], undefined, multipart)
    const filled = await executeChatGPTDOMScript(key, target.entry, 'fill-durable-retry', chatGPTFillComposerScript(bootstrap))
    if (!filled) throw new Error('ChatGPT composer DOM could not be populated with the persisted request')
    for (let index = 0; index < files.length; index += 1) await pasteChatGPTFile(target.entry, files[index].path, index + 1, files.length)
    await wait(chatInputSettleDelay(totalBytes, files.length))
    const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
    armExpectedChatGPTBundle(key, requestId, assistantBaseline, bootstrap, [], String(request?.recoveryPrompt || ''), sessionId, expectedFilename)
    try { await submitChatGPTDraft(key, target.entry, target.conversationUrl, target) }
    catch (error) { disarmExpectedChatGPTBundle(key, requestId); throw error }
    clearChatGPTHumanAction(key, 'entrada persistida reenviada')
    return { ok: true, cacheKey: key, requestId, attachmentCount: files.length, submitted: true, expectedFilename, includedContext: true, conversationUrl: targetURL, durable: true }
  }

  return { retryPersistedChatGPTPrompt }
}
