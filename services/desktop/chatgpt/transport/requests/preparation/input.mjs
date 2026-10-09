export function createChatInputPreparation({
  chatAgentWorkerActivity, requestPreparationTimer,
  throwIfChatGPTTransportAborted, fetchChatTransportLimits,
  decodeChatAttachmentSet, decodeChatArtifactSet, path, app, rm, mkdir,
  fetchRequestKnowledge, fetchRequestGitContext, fetchRequestContinuation,
  fetchSelectedContextZip, writeChatInputTransportArchives,
  boundedChatInputPartBytes, persistChatArtifact, readFile, randomUUID,
  withRequestPreparationDeadline, localChatInputBootstrap,
  chatGPTFillComposerScript, pasteChatGPTFile, wait, chatInputSettleDelay,
}) {
  async function materializeChatInput(cacheKey, sessionId, requestId, values, artifactValues, promptText, includeContext, projectFiles = [], requestMetadata = {}, signal, bundleChatID = cacheKey) {
    chatAgentWorkerActivity.set('preparing')
    const timer = requestPreparationTimer(requestId)
    throwIfChatGPTTransportAborted(signal)
    const limits = await fetchChatTransportLimits(signal)
    const { decoded } = decodeChatAttachmentSet(values, limits)
    const artifacts = decodeChatArtifactSet(artifactValues)
    const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', cacheKey)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const [knowledge, gitContext, continuation, eagerContext] = await Promise.all([
      fetchRequestKnowledge(sessionId, requestId, signal),
      fetchRequestGitContext(sessionId, signal),
      fetchRequestContinuation(sessionId, requestId, signal),
      includeContext ? fetchSelectedContextZip(sessionId, signal) : Promise.resolve(undefined),
    ])
    throwIfChatGPTTransportAborted(signal)
    // A derived request must be self-contained even when the linked ChatGPT
    // conversation forgot or truncated an earlier snapshot. The delta remains
    // useful for focus, while the current context selection is authoritative.
    const context = eagerContext || (continuation.length ? await fetchSelectedContextZip(sessionId, signal) : undefined)
    timer.phase('inputs-loaded')
    const transport = await writeChatInputTransportArchives(dir, {
      chatId: bundleChatID, requestId, maxTotalBytes: limits.totalBytes, maxPartBytes: boundedChatInputPartBytes(limits), maxParts: limits.partLimit,
      requestMetadata, prompt: promptText, context, knowledge, gitContext, continuation, attachments: decoded,
      artifacts: artifacts.decoded, projectFiles, signal,
    })
    throwIfChatGPTTransportAborted(signal)
    timer.phase('zip-written', `bytes=${transport.bytes} parts=${transport.parts.length}`)
    for (const part of transport.parts) await persistChatArtifact(sessionId, requestId, 'input', 'bundle', part.name, 'application/zip', await readFile(part.path), signal)
    if (context) await persistChatArtifact(sessionId, requestId, 'input', 'context', `context-${requestId}.zip`, 'application/zip', context.bytes, signal)
    for (const attachment of decoded) await persistChatArtifact(sessionId, requestId, 'input', 'attachment', attachment.name, attachment.mime, attachment.bytes, signal).catch((error) => console.warn(`[chat-input] attachment artifact persistence skipped for ${attachment.name}: ${error instanceof Error ? error.message : String(error)}`))
    for (const artifact of artifacts.decoded) await persistChatArtifact(sessionId, requestId, 'input', 'system-artifact', artifact.name, artifact.mime, artifact.bytes, signal)
    timer.phase('artifacts-persisted')
    return { ...transport, userAttachmentCount: decoded.length, artifactCount: artifacts.decoded.length, archiveEntryCount: transport.fileCount }
  }

  async function materializeProtocolChatInput(cacheKey, sessionId, requestId, promptText, values = [], requestMetadata = {}, signal) {
    throwIfChatGPTTransportAborted(signal)
    const limits = await fetchChatTransportLimits(signal)
    const { decoded } = decodeChatAttachmentSet(values, limits)
    const dir = path.join(app.getPath('temp'), 'wharness-chat-protocol', cacheKey, `${Date.now()}-${randomUUID()}`)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const [context, knowledge, gitContext, continuation] = await Promise.all([
      fetchSelectedContextZip(sessionId, signal),
      fetchRequestKnowledge(sessionId, requestId, signal),
      fetchRequestGitContext(sessionId, signal),
      fetchRequestContinuation(sessionId, requestId, signal),
    ])
    const transport = await writeChatInputTransportArchives(dir, {
      chatId: cacheKey, requestId, maxTotalBytes: limits.totalBytes, maxPartBytes: boundedChatInputPartBytes(limits), maxParts: limits.partLimit,
      requestMetadata, prompt: promptText, context, knowledge, gitContext, continuation, attachments: decoded, signal,
    })
    throwIfChatGPTTransportAborted(signal)
    for (const part of transport.parts) await persistChatArtifact(sessionId, requestId, 'input', 'bundle', part.name, 'application/zip', await readFile(part.path), signal)
    return { ...transport, attachmentCount: decoded.length, archiveEntryCount: transport.fileCount }
  }

  async function fillBundledChatGPTComposer(key, entry, sessionId, requestId, promptText, expectedFilename, attachments = [], requestMetadata = {}) {
    const signal = entry?.transportAbortSignal
    const input = await withRequestPreparationDeadline(signal, (bounded) => materializeProtocolChatInput(key, sessionId, requestId, promptText, attachments, requestMetadata, bounded))
    const bootstrap = localChatInputBootstrap(requestId, input.archiveName, expectedFilename, input.requestMetadata, input.multipart)
    try {
      throwIfChatGPTTransportAborted(signal)
      const filled = await entry.view.webContents.executeJavaScript(chatGPTFillComposerScript(bootstrap), true)
      if (!filled) throw new Error('ChatGPT composer DOM could not be populated with bundled protocol input')
      for (let index = 0; index < input.uploadPaths.length; index += 1) await pasteChatGPTFile(entry, input.uploadPaths[index], index + 1, input.uploadPaths.length)
      await wait(chatInputSettleDelay(input.bytes, input.uploadPaths.length))
      throwIfChatGPTTransportAborted(signal)
      return { ...input, bootstrap }
    } finally {
      await rm(path.dirname(input.archivePath), { recursive: true, force: true }).catch(() => undefined)
    }
  }

  return { materializeChatInput, materializeProtocolChatInput, fillBundledChatGPTComposer }
}
