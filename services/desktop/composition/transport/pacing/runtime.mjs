import { createChatGPTConversationReadHealth } from '../../../chatgpt/session/health/conversation-reads/index.mjs'
import { createChatGPTRateLimitResume } from '../../../chatgpt/session/health/rate-limit-resume.mjs'
import { createWorkerPacing } from '../../../agent/scheduling/residency/worker-pacing.mjs'
import { createChatGPTFileUpload } from '../../../chatgpt/transport/uploads/paste-runtime.mjs'
import {
  createChatGPTUploadLimitGate, ChatGPTUploadLimitDeferral, chatGPTUploadAffordanceScript, uploadAffordanceDisabled,
} from '../../../chatgpt/session/health/upload-limit.mjs'
import { onChatGPTAccountChanged } from '../../../chatgpt/session/health/account-change.mjs'

export function createDesktopChatGPTPacing(d) {
  const readHealth = createChatGPTConversationReadHealth({
    chatGPTConversationLoadFailureScript: d.chatGPTConversationLoadFailureScript,
    canonicalChatGPTConversationURL: d.canonicalChatGPTConversationURL,
    chatGPTConversationID: d.chatGPTConversationID, wait: d.wait,
    paceChatGPTWorkerNavigation: (...args) => pacing.paceChatGPTWorkerNavigation(...args),
    createConversationUnavailable: (delayMs) => new pacing.ChatGPTConversationUnavailable(delayMs),
    chatAgentResidency: d.chatAgentResidency,
    createChatGPTAffinityTracker: d.createChatGPTAffinityTracker,
  })
  function noteOrchestrationTaskPin(worker, task, result) {
    const entry = d.workerEntryForIndex(worker)
    if (!entry) return
    const outcome = d.orchestrationTaskPins.note(entry.slotId, task, result)
    if (outcome) console.log(`[chat-agent] orchestration-pin slot=${entry.slotId} task=${String(task?.chat_id || '')} ${outcome} status=${String(result?.status || '')}`)
  }
  const resume = createChatGPTRateLimitResume({
    state: d.rateLimitState,
    chatGPTWorkerEntries: d.chatGPTWorkerEntries,
    chatGPTKeyForEntry: d.chatGPTKeyForEntry,
    paceChatGPTWorkerNavigation: (...args) => pacing.paceChatGPTWorkerNavigation(...args),
    isTrustedChatGPTOrigin: d.isTrustedChatGPTOrigin,
    homeURL: d.CHATGPT_URL, userAgent: d.CHATGPT_USER_AGENT,
    wait: d.wait, waitForChatGPTReady: d.waitForChatGPTReady,
    chatGPTHumanActionScript: d.chatGPTHumanActionScript,
    noteChatGPTRateLimitGate: d.noteChatGPTRateLimitGate,
    sanitizeDiagnosticURL: d.sanitizeDiagnosticURL,
  })
  const pacing = createWorkerPacing({
    getRuntimeDiagnostics: d.getRuntimeDiagnostics,
    CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS: d.CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS,
    CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS: d.CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS,
    CHATGPT_WORKER_NAVIGATION_GAP_MS: d.CHATGPT_WORKER_NAVIGATION_GAP_MS,
    CHAT_AGENT_WORKER_ACTION_GAP_MS: d.CHAT_AGENT_WORKER_ACTION_GAP_MS,
    chatAgentWorkerActivity: d.chatAgentWorkerActivity,
    chatGPTWorkerPacer: d.chatGPTWorkerPacer,
    CHAT_AGENT_SUBMIT_GAP_MS: d.CHAT_AGENT_SUBMIT_GAP_MS,
    CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS: d.CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS,
    CHAT_AGENT_TRANSLATION_ACTION_GAP_MS: d.CHAT_AGENT_TRANSLATION_ACTION_GAP_MS,
    chatAgentRateLimitDelayMs: resume.chatAgentRateLimitDelayMs,
    loadOwnedChatGPTURL: d.loadOwnedChatGPTURL,
    waitForChatGPTSurfaceReady: d.waitForChatGPTSurfaceReady,
    chatAgentResidency: d.chatAgentResidency,
  })
  // One gate per Desktop process, like the account it protects. It persists
  // to the backend hold so a restart keeps the window and the operator can
  // release it, and the runtime refresh feeds the durable hold back in.
  const uploadLimitGate = createChatGPTUploadLimitGate({
    persist: (hold) => {
      const scheduler = d.rateLimitState.scheduler
      void scheduler?.setAutomationHold('chatgpt_upload', { ...hold, source: 'desktop' })
        .catch((error) => console.warn(`[chatgpt-upload-limit] persist failed: ${error instanceof Error ? error.message : String(error)}`))
    },
  })
  d.rateLimitState.onAutomationHolds = (holds) => uploadLimitGate.adopt(holds?.chatgpt_upload)
  onChatGPTAccountChanged((reason) => uploadLimitGate.release(reason))
  const upload = createChatGPTFileUpload({
    chatGPTKeyForEntry: d.chatGPTKeyForEntry,
    requireOwnedChatGPTEntry: d.requireOwnedChatGPTEntry,
    pasteWithUploadRetry: d.pasteWithUploadRetry,
    paceChatGPTWorkerSubmission: pacing.paceChatGPTWorkerSubmission,
    chatAgentRateLimitDelayMs: resume.chatAgentRateLimitDelayMs,
    ChatGPTRateLimitDeferral: pacing.ChatGPTRateLimitDeferral,
    chatAgentWorkerActivity: d.chatAgentWorkerActivity,
    waitForChatGPTSurfaceReady: d.waitForChatGPTSurfaceReady,
    chatGPTComposerReadyScript: d.chatGPTComposerReadyScript,
    chatGPTUploadThumbnailScript: d.chatGPTUploadThumbnailScript,
    path: d.path, chatGPTUploads: d.chatGPTUploads,
    selectChatGPTUploadFile: d.selectChatGPTUploadFile,
    chatGPTHumanActionScript: d.chatGPTHumanActionScript,
    setChatGPTHumanAction: d.setChatGPTHumanAction,
    chatGPTHumanActionMessage: d.chatGPTHumanActionMessage,
    uploadLimitGate, ChatGPTUploadLimitDeferral, chatGPTUploadAffordanceScript, uploadAffordanceDisabled,
  })
  return { ...readHealth, noteOrchestrationTaskPin, ...resume, ...pacing, ...upload, uploadLimitGate }
}
