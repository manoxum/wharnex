import { createChatGPTRequestContextClient } from '../../../chatgpt/transport/requests/request-context.mjs'
import { createChatGPTAttachmentTools } from '../../../chatgpt/transport/attachments/attachments.mjs'
import { createChatInputPreparation } from '../../../chatgpt/transport/requests/preparation/input.mjs'
import { createChatGPTRendererStability } from '../../../chatgpt/session/views/renderer-stability.mjs'

export function createDesktopRequestPreparation(d) {
  const context = createChatGPTRequestContextClient({
    backendURL: d.BACKEND_URL, maxContextBytes: d.MAX_CONTEXT_BYTES,
  })
  async function persistChatArtifact(sessionId, requestId, direction, kind, filename, contentType, bytes, signal) {
    return d.uploadChatArtifact(d.BACKEND_URL, d.sanitizeSessionId(sessionId),
      { requestId, direction, kind, filename, contentType, bytes }, signal)
  }
  async function requireAutoSession(sessionId, signal) {
    const id = d.sanitizeSessionId(sessionId)
    const target = new URL(`/api/sessions/${encodeURIComponent(id)}`, d.BACKEND_URL)
    const response = await d.fetch(target, { redirect: 'error', signal })
    if (!response.ok) throw new Error(`Session lookup HTTP ${response.status}`)
    const sessionState = await response.json()
    if (!['auto', 'auto_approve'].includes(sessionState?.automation_mode)) {
      throw new Error('Automatic ChatGPT submission requires a project automatic mode')
    }
  }
  const attachments = createChatGPTAttachmentTools({
    backendURL: d.BACKEND_URL,
    userDataPath: () => d.app.getPath('userData'),
    nativeImage: d.nativeImage,
    getFileIcon: (...args) => d.app.getFileIcon(...args),
  })
  const input = createChatInputPreparation({
    chatAgentWorkerActivity: d.chatAgentWorkerActivity,
    requestPreparationTimer: d.requestPreparationTimer,
    throwIfChatGPTTransportAborted: d.throwIfChatGPTTransportAborted,
    fetchChatTransportLimits: attachments.fetchChatTransportLimits,
    decodeChatAttachmentSet: attachments.decodeChatAttachmentSet,
    decodeChatArtifactSet: attachments.decodeChatArtifactSet,
    path: d.path, app: d.app, rm: d.rm, mkdir: d.mkdir,
    fetchRequestKnowledge: context.fetchRequestKnowledge,
    fetchRequestGitContext: context.fetchRequestGitContext,
    fetchRequestContinuation: context.fetchRequestContinuation,
    fetchSelectedContextZip: context.fetchSelectedContextZip,
    writeChatInputTransportArchives: d.writeChatInputTransportArchives,
    boundedChatInputPartBytes: d.boundedChatInputPartBytes,
    persistChatArtifact, readFile: d.readFile, randomUUID: d.randomUUID,
    withRequestPreparationDeadline: d.withRequestPreparationDeadline,
    localChatInputBootstrap: d.localChatInputBootstrap,
    chatGPTFillComposerScript: d.chatGPTFillComposerScript,
    pasteChatGPTFile: (...args) => d.pasteChatGPTFile(...args),
    wait: d.wait, chatInputSettleDelay: d.chatInputSettleDelay,
  })
  const renderer = createChatGPTRendererStability({
    sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    requireOwnedChatGPTEntry: d.requireOwnedChatGPTEntry,
    evaluateChatGPTDOMWithDeadline: d.evaluateChatGPTDOMWithDeadline,
    wait: d.wait, waitForChatGPTReady: d.waitForChatGPTReady,
    isTrustedChatGPTOrigin: d.isTrustedChatGPTOrigin,
    recoverChatGPTConversationLoadFailure: (...args) => d.recoverChatGPTConversationLoadFailure(...args),
  })
  return { ...context, persistChatArtifact, requireAutoSession, ...attachments, ...input, ...renderer }
}
