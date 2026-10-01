type DesktopAgentRuntimeTask = {
  task_id: string; type: string; chat_id: string; project_id: string; request_id: string; root_request_id: string; conversation_id: string; status: string
  attempt: number; max_attempts: number; assigned_worker: string; keep_flowing: boolean; lease_expires_at: string; not_before: string; last_error: string; created_at: string; updated_at: string
}
type DesktopAgentRuntimeBrowser = { available: boolean; web_contents_id: number; os_process_id?: number; url: string; title: string; loading: boolean }
type DesktopAgentRuntimeResidency = { slot_id: string; resident_lane: string; resident_since: string; min_resident_until: string; assignment_epoch: number; rotation_position: number; navigation_in_progress: boolean; non_preemptive: boolean }
type DesktopAgentRuntimeActivityPhase = 'claimed' | 'waiting_turn' | 'navigating' | 'preparing' | 'uploading' | 'submitting' | 'processing' | 'downloading' | 'validating'
type DesktopAgentRuntimeActivity = { phase: DesktopAgentRuntimeActivityPhase; since: string; task_id: string }
type DesktopAgentRuntimeAgent = {
  id: string; label: string; role: 'supervisor' | 'worker'; status: 'idle' | 'loading' | 'claimed' | 'running' | 'stopped' | 'error' | string
  draining: boolean; loop_active?: boolean; interacting?: boolean; monitor_open?: boolean; chat_id: string; task?: DesktopAgentRuntimeTask; last_task?: DesktopAgentRuntimeTask; last_claim_at?: string
  keep_flowing?: boolean; keep_flowing_active?: boolean; error: string; browser: DesktopAgentRuntimeBrowser; memory?: { available: boolean; rss_bytes: number; os_process_id: number; shared_process: boolean }; residency?: DesktopAgentRuntimeResidency
  // The phase inside a Worker's current task; null between tasks.
  activity?: DesktopAgentRuntimeActivity | null
  // Whether the slot is engaged right now, independently of whether it happens
  // to hold the lease at this instant. Supervision hands the lease back between
  // observations, so rendering the lease alone made a busy slot alternate
  // between occupied and free for the whole length of a request.
  occupied?: boolean
  // The Orchestrator task a Worker is pinned to until that task ends; it holds
  // the task between rounds, as a Supervisor holds its chat.
  pinned_task_id?: string
  // A browser created for one planning, release-notes or translation task.
  ephemeral?: boolean
  suspended?: boolean
  // Canonical host path of the project this slot is working for, carried at
  // agent level for the same reason: a Supervisor between observations has no
  // lease to read it from.
  project_id?: string
  // Why a Supervisor may not release its chat yet (empty when it is free to be
  // rebound): 'expected-bundle' | 'bundle-delivery' | 'queued-comment' |
  // 'transport' | 'account-operation' | 'human-action' | 'external-auth' |
  // 'supervisor-lease' | 'prepared-prompt'.
  binding_hold?: string
}
type DesktopAgentRuntimeState = {
  instance_id: string; desired_supervisors: number; configured_supervisors: number; desired_workers: number; configured_workers: number; policies: { auto_scale: boolean; auto_scale_max_supervisors: number; auto_scale_max_workers: number; keep_flowing_global: boolean; keep_flowing_workers: string[]; workers_suspended: boolean; workers_suspended_until: string; workers_suspended_types?: string[]; rate_limit_cooldown_minutes: number; auto_scaled_supervisors: number; auto_scaled_workers: number }; limits: { min_supervisors: number; max_supervisors: number; min_workers: number; max_workers: number }
  scheduler: { running: boolean; backend_reachable: boolean; last_refresh_at: string; last_error: string }
  queue: { queued: number; counts: Record<string, number>; due: number; due_supervisor_lanes?: number; due_worker?: number; due_translator?: number; scheduled: number; guarded?: number; blocked: number; oldest_due_created_at: string; next_not_before: string }
  provider: { provider: string; paused: boolean; paused_until: string; reason: string; updated_at: string; rate_limit_level?: number; last_rate_limit_at?: string; last_rate_limit_source?: string; last_valid_bundle_at?: string; average_processing_ms?: number; valid_sample_count?: number; initial_wait_ms?: number }
  worker_pause: { paused: boolean; paused_until: string; task_types?: string[] }
  memory?: { available: boolean; total_workers_bytes: number; total_supervisors_bytes: number; total_agents_bytes: number; desktop_bytes: number; total_bytes: number }
  agents: DesktopAgentRuntimeAgent[]
}
type DesktopMirrorFrame = { width: number; height: number; data: Uint8Array<ArrayBuffer> }
type DesktopMirrorFrameHandler = (frame: DesktopMirrorFrame, ready: () => void) => void
type DesktopMirrorInput = {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel' | 'keyDown' | 'keyUp'
  modifiers: number; nx?: number; ny?: number; button?: 'none' | 'left' | 'middle' | 'right'; buttons?: number; clickCount?: number
  deltaX?: number; deltaY?: number; key?: string; code?: string; keyCode?: number
}
interface WharnessDesktopBridge {
  agents: {
    state(): Promise<DesktopAgentRuntimeState>
    setSupervisorCount(count: number): Promise<DesktopAgentRuntimeState>
    setWorkerCount(count: number): Promise<DesktopAgentRuntimeState>
    setPolicies(policies: { auto_scale?: boolean; auto_scale_max_supervisors?: number; auto_scale_max_workers?: number; keep_flowing_global?: boolean; rate_limit_cooldown_minutes?: number }): Promise<DesktopAgentRuntimeState>
    setWorkerKeepFlowing(agentId: string, enabled: boolean): Promise<DesktopAgentRuntimeState>
    pauseWorkers(pausedUntil?: string, taskTypes?: string[]): Promise<DesktopAgentRuntimeState>
    resumeWorkers(): Promise<DesktopAgentRuntimeState>
    pauseProvider(pausedUntil?: string): Promise<DesktopAgentRuntimeState>
    resumeProvider(): Promise<DesktopAgentRuntimeState>
    snapshot(agentId: string): Promise<{ agentId: string; dataUrl: string; capturedAt: string }>
    openMonitor(agentId: string): Promise<{ ok: boolean; agentId: string; alreadyOpen: boolean }>
    closeMonitor(agentId: string): Promise<{ ok: boolean; agentId: string; closed: boolean }>
    openDevTools(agentId: string): Promise<{ ok: boolean; agentId: string }>
    openInteraction(agentId: string, bounds: DesktopBounds): Promise<{ ok: boolean; agentId: string; bounds: DesktopBounds }>
    setInteractionBounds(agentId: string, bounds: DesktopBounds): Promise<{ ok: boolean; agentId: string; bounds?: DesktopBounds }>
    closeInteraction(agentId: string): Promise<{ ok: boolean; agentId: string; closed: boolean }>
    // The real view is composited in place in the browser monitor window.
    presentInMonitor(agentId: string, bounds: DesktopBounds): Promise<{ ok: boolean; agentId: string; bounds: DesktopBounds }>
    resizeInMonitor(agentId: string, bounds: DesktopBounds): Promise<{ ok: boolean; agentId: string; bounds?: DesktopBounds }>
    releaseFromMonitor(agentId: string): Promise<{ ok: boolean; agentId: string; released: boolean }>
    onMonitorSelect(callback: (selection: { agentId: string }) => void): () => void
    // A surfaced Worker is shown in the project as a mirror of its real view.
    mirrorInput(agentId: string, input: DesktopMirrorInput): Promise<{ ok: boolean }>
    subscribeMirror(agentId: string, onFrame: DesktopMirrorFrameHandler): () => void
    onState(callback: (state: DesktopAgentRuntimeState) => void): () => void
  }
}
