import { CHAT_AGENT_NAVIGATION_GAP_MS, CHAT_AGENT_WORKER_ACTION_GAP_MS } from '../../agent/index.mjs'
import { CHATGPT_CHROMIUM_VERSION } from '../../chatgpt/config/index.mjs'
import { chromeCompatibleUserAgent } from '../../security/security.mjs'

// Composition-time settings, named exactly as the domains consume them.
export function createDesktopCompositionSettings({ environment = process.env, platform = process.platform } = {}) {
  const retentionHours = Math.max(1, Math.min(24 * 30, Number(environment.WHARNESS_CHATGPT_BUNDLE_RETENTION_HOURS || 72) || 72))
  return {
    CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS: 5_000,
    CHATGPT_USER_AGENT: chromeCompatibleUserAgent(platform, CHATGPT_CHROMIUM_VERSION),
    CHATGPT_BUNDLE_RETENTION_MS: retentionHours * 60 * 60 * 1000,
    // A grown pool must remain stable across several two-second demand polls.
    CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS: 20_000,
    CHAT_AGENT_RUNTIME_STATE_BROADCAST_MS: 250,
    // Submission spacing widens under provider pressure and later decays.
    CHAT_AGENT_SUBMIT_GAP_MS: CHAT_AGENT_WORKER_ACTION_GAP_MS,
    CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS: 60_000,
    CHATGPT_WORKER_NAVIGATION_GAP_MS: CHAT_AGENT_NAVIGATION_GAP_MS,
    CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS: CHAT_AGENT_WORKER_ACTION_GAP_MS,
    FRONTEND_RENDERER_RESTART_LIMIT: 5,
    // Paint the local shell before allocating hidden authenticated views.
    CHAT_AGENT_STARTUP_DELAY_MS: 2_500,
    CHAT_AGENT_WORKER_SPAWN_GAP_MS: 1_500,
  }
}
