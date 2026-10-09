// Utility jobs own a temporary browser until their exact artifact settles;
// they never consume an Orchestrator execution Worker slot.
// UI Lab exchanges are not here: they run on the persistent Workers, whose
// pacing, suspension and upload accounting the operator controls (ADR-0093).
export const EPHEMERAL_WORKER_TASK_TYPES = new Set(['TRANSLATE_MARKDOWN', 'ORCHESTRATOR_PLAN', 'RELEASE_NOTES'])
export const EPHEMERAL_AGENT_ID = /^(ephemeral|translator)-cat_[a-f0-9]{20}$/
export const EPHEMERAL_WORKER_LABELS = {
  ORCHESTRATOR_PLAN: 'Planeamento', RELEASE_NOTES: 'Release notes', TRANSLATE_MARKDOWN: 'Tradução',
}
export const EPHEMERAL_WORKER_IDLE_RETIRE_MS = 20 * 60_000
export const EPHEMERAL_WORKER_PACE_PRIORITY = 2
