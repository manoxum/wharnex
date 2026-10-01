import { CHAT_AGENT_NAVIGATION_GAP_MS, CHAT_AGENT_WORKER_ACTION_GAP_MS } from '../../agent/index.mjs'
import { CHATGPT_CHROMIUM_VERSION } from '../../chatgpt/config/index.mjs'
import { chromeCompatibleUserAgent } from '../../security/security.mjs'

export function createDesktopCompositionSettings({ environment = process.env, platform = process.platform } = {}) {
  const retentionHours = Math.max(1, Math.min(24 * 30, Number(environment.WHARNESS_CHATGPT_BUNDLE_RETENTION_HOURS || 72) || 72))
  return {
    staleAssignmentRetryMs: 5_000,
    chatGPTUserAgent: chromeCompatibleUserAgent(platform, CHATGPT_CHROMIUM_VERSION),
    bundleRetentionMs: retentionHours * 60 * 60 * 1000,
    // A grown pool must remain stable across several two-second demand polls.
    autoScaleDrainCooldownMs: 20_000,
    runtimeStateBroadcastMs: 250,
    // Submission spacing widens under provider pressure and later decays.
    submitGapMs: CHAT_AGENT_WORKER_ACTION_GAP_MS,
    submitGapRecoveryMs: 60_000,
    navigationGapMs: CHAT_AGENT_NAVIGATION_GAP_MS,
    navigationGapHealthyMs: CHAT_AGENT_WORKER_ACTION_GAP_MS,
    frontendRendererRestartLimit: 5,
    // Paint the local shell before allocating hidden authenticated views.
    startupDelayMs: 2_500,
    workerSpawnGapMs: 1_500,
  }
}
