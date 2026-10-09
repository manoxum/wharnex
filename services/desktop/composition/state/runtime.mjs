import {
  ChatAgentGlobalPacer, ChatAgentResidency, OrchestrationTaskPins,
  WorkerActivity, DEFAULT_SUPERVISOR_SLOTS, DEFAULT_WORKER_SLOTS,
  normalizeChatAgentPolicies,
} from '../../agent/index.mjs'
import { ChatGPTAccountProviderChain } from '../../chatgpt/account/index.mjs'
import { ChatGPTSubmitCoordinator, ChatGPTUploadCoordinator, createManualChatGPTTransport } from '../../chatgpt/transport/index.mjs'

export function createDesktopRuntimeState({ clipboard, ClipboardItem, environment = process.env, publishAgentState, publishChatGPTState }) {
  let activityPublishTimer
  return {
    window: { mainWindow: undefined, desktopTrayControl: undefined, quitting: false, explicitDesktopExit: false },
    agent: {
      chatSupervisorScheduler: undefined,
      chatTranslatorScheduler: undefined,
      dueChatTranslations: 0,
      configuredChatAgentSupervisorSlots: DEFAULT_SUPERVISOR_SLOTS,
      desiredChatAgentSupervisorSlots: DEFAULT_SUPERVISOR_SLOTS,
      configuredChatAgentWorkerSlots: DEFAULT_WORKER_SLOTS,
      desiredChatAgentWorkerSlots: DEFAULT_WORKER_SLOTS,
      chatAgentPolicies: normalizeChatAgentPolicies(),
      chatAgentScheduler: undefined,
      chatAgentRuntimeDiagnostics: {
        scheduler: { running: false, backend_reachable: false, last_refresh_at: '', last_error: '' },
        queue: { queued: 0, counts: {}, due: 0, scheduled: 0, guarded: 0, blocked: 0, oldest_due_created_at: '', next_not_before: '' },
        provider: { provider: 'chatgpt', paused: false, paused_until: '', reason: '', rate_limit_level: 0, last_rate_limit_at: '', last_rate_limit_source: '', last_valid_bundle_at: '', average_processing_ms: 0, valid_sample_count: 0, initial_wait_ms: 60_000, updated_at: '' },
      },
      chatAgentResidency: new ChatAgentResidency({ minResidenceMs: Number(environment.WHARNESS_CHAT_AGENT_RESIDENCY_MS || 30_000) }),
      orchestrationTaskPins: new OrchestrationTaskPins(),
      chatGPTWorkerPacer: new ChatAgentGlobalPacer(),
      chatAgentWorkerActivity: new WorkerActivity({
        onChange: () => {
          if (activityPublishTimer) return
          activityPublishTimer = setTimeout(() => {
            activityPublishTimer = undefined
            publishAgentState()
          }, 250)
        },
      }),
      chatAgentWorkerLastGrowAt: 0,
      chatAgentSupervisorLastGrowAt: 0,
    },
    chatgpt: {
      deferredSupervisorNavigation: undefined,
      deferredSupervisorNavigationTimer: undefined,
      pollingChatGPTVisibleActivity: false,
      chatGPTRateLimitUntil: 0,
      chatGPTAutomationHoldsListener: null,
      chatGPTRateLimitResumeProbeRequired: false,
      chatGPTRateLimitResumeProbe: undefined,
      chatGPTRateLimitResumeProbeNotBefore: 0,
      chatGPTRateLimitHits: [],
      chatGPTRateLimitKind: '',
      chatGPTRateLimitAppliedAt: 0,
      manualChatGPTTransport: createManualChatGPTTransport({ clipboard, ClipboardItem, onStateChange: publishChatGPTState }),
      chatGPTAccountProviders: new ChatGPTAccountProviderChain({}),
      chatGPTDownloadPoller: undefined,
      recentExpectedDownload: undefined,
      chatGPTUploads: new ChatGPTUploadCoordinator(),
      chatGPTSubmissions: new ChatGPTSubmitCoordinator(),
    },
  }
}
