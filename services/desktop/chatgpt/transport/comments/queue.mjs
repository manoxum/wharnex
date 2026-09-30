import { createHash } from 'node:crypto'

export function createChatGPTCommentQueue({
  sanitizeChatCacheKey, canonicalBundleFilename, normalizeChatGPTReasoningEffort,
  pendingChatGPTComments, recentChatGPTCommentIds, recentChatGPTCommentFingerprints,
  flushingChatGPTComments, sanitizeSessionId, chatgptViews,
  withChatGPTTransportPreparation, targetChatGPTComposer, executeChatGPTDOMScript,
  chatGPTComposerReadyScript, expectedChatGPTBundles, fillBundledChatGPTComposer,
  chatGPTAssistantTurnCount, wait, submitChatGPTDraft, armExpectedChatGPTBundle,
  touchChatGPTEntry, sendToChatGPTKey,
}) {
  function chatGPTCommentFingerprint(key, requestId, comment, attachments = []) {
    const attachmentSignature = attachments.map((item) => [item?.name, item?.size, item?.type || item?.mime].map((value) => String(value || '')).join(':')).join('|')
    return createHash('sha256').update(`${key}\0${requestId}\0${comment}\0${attachmentSignature}`).digest('hex')
  }

  async function queueChatGPTComment(request) {
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const requestId = String(request?.requestId || '').trim()
    const comment = String(request?.text || '').trim()
    if (!comment) throw new Error('Task comment is empty')
    if (comment.length > 16_000) throw new Error('Task comment exceeds 16 KiB limit')
    const expectedFilename = canonicalBundleFilename(key, requestId)
    const text = `USER COMMENT FOR THE ACTIVE WHARNEX TASK:
${comment}

Treat this as additional guidance for the SAME task and SAME request. Do not replace, cancel or downgrade the original deliverable. Continue the work and still return the required canonical bundle ${expectedFilename}.`
    const commentId = String(request?.commentId || `${requestId}:${comment}`).slice(0, 20000)
    const attachments = Array.isArray(request?.attachments) ? request.attachments : []
    const reasoningEffort = normalizeChatGPTReasoningEffort(request?.reasoningEffort)
    const fingerprint = chatGPTCommentFingerprint(key, requestId, comment, attachments)
    const now = Date.now()
    const priorAt = recentChatGPTCommentIds.get(`${key}:${commentId}`) || 0
    const priorFingerprintAt = recentChatGPTCommentFingerprints.get(fingerprint) || 0
    if (now - priorAt < 30 * 60 * 1000 || now - priorFingerprintAt < 60 * 1000) return { ok: true, cacheKey: key, queued: hasPendingChatGPTComments(key), requestId, duplicate: true }
    const queue = pendingChatGPTComments.get(key) || []
    const sessionId = request?.sessionId ? sanitizeSessionId(request.sessionId) : ''
    if (!queue.some((item) => item.commentId === commentId || item.fingerprint === fingerprint)) queue.push({ commentId, fingerprint, text, comment, sessionId, url: String(request?.url || ''), requestId, attachments, reasoningEffort, queuedAt: now })
    pendingChatGPTComments.set(key, queue)
    await flushQueuedChatGPTComments()
    return { ok: true, cacheKey: key, queued: Boolean(pendingChatGPTComments.get(key)?.length), requestId }
  }

  function hasPendingChatGPTComments(key) {
    return Boolean(pendingChatGPTComments.get(key)?.length)
  }

  async function flushQueuedChatGPTComments() {
    for (const [key, queue] of pendingChatGPTComments) {
      while (queue.length && Date.now() - queue[0].queuedAt > 30 * 60 * 1000) queue.shift()
      if (!queue.length) { pendingChatGPTComments.delete(key); continue }
      if (flushingChatGPTComments.has(key)) continue
      const ownedEntry = chatgptViews.get(key)
      if (!ownedEntry || ownedEntry.humanAction?.active) continue
      flushingChatGPTComments.add(key)
      const pending = queue[0]
      try {
        await withChatGPTTransportPreparation(key, ownedEntry, pending.requestId, async () => {
          const target = await targetChatGPTComposer(key, pending.url, false)
          target.reasoningEffort = normalizeChatGPTReasoningEffort(pending.reasoningEffort)
          target.entry.reasoningEffort = target.reasoningEffort
          const ready = await executeChatGPTDOMScript(key, target.entry, 'comment-composer-ready', chatGPTComposerReadyScript())
          if (!ready) return
          const expected = expectedChatGPTBundles.get(key)
          const commentPrompt = expected?.requestId === pending.requestId && expected.originalPrompt
            ? `${pending.text}\n\nORIGINAL REQUEST CONTENT — authoritative task context repeated inside this comment bundle:\n\n${expected.originalPrompt}`
            : pending.text
          const expectedFilename = expected?.requestId === pending.requestId ? expected.filename : canonicalBundleFilename(key, pending.requestId)
          const requestMetadata = expected?.requestId === pending.requestId ? expected.requestMetadata || {} : pending.requestMetadata || {}
          const bundled = await fillBundledChatGPTComposer(key, target.entry, pending.sessionId, pending.requestId, commentPrompt, expectedFilename, pending.attachments, requestMetadata)
          const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
          await wait(80)
          await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)
          queue.shift()
          recentChatGPTCommentIds.set(`${key}:${pending.commentId}`, Date.now())
          recentChatGPTCommentFingerprints.set(pending.fingerprint, Date.now())
          if (!queue.length) pendingChatGPTComments.delete(key)
          if (expectedChatGPTBundles.has(key)) armExpectedChatGPTBundle(key, pending.requestId, assistantBaseline, '', [], '', pending.sessionId, expectedFilename, requestMetadata)
          touchChatGPTEntry(target.entry)
          sendToChatGPTKey(key, 'wharness:chatgpt:comment-sent', { cacheKey: key, requestId: pending.requestId, attachments: bundled.attachmentCount })
        })
        break
      } catch (error) {
        console.warn(`[chatgpt-comment] queued key=${key} error=${error instanceof Error ? error.message : String(error)}`)
      } finally {
        flushingChatGPTComments.delete(key)
        const cutoff = Date.now() - 30 * 60 * 1000
        const fingerprintCutoff = Date.now() - 60 * 1000
        for (const [id, sentAt] of recentChatGPTCommentIds) if (sentAt < cutoff) recentChatGPTCommentIds.delete(id)
        for (const [fingerprint, sentAt] of recentChatGPTCommentFingerprints) if (sentAt < fingerprintCutoff) recentChatGPTCommentFingerprints.delete(fingerprint)
      }
    }
  }
  return { queueChatGPTComment, hasPendingChatGPTComments, flushQueuedChatGPTComments }
}
