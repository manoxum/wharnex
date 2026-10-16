export function installMonitorFixture() {
  const runtime: DesktopAgentRuntimeState = {
    instance_id: 'fixture', desired_supervisors: 1, configured_supervisors: 1, desired_workers: 1, configured_workers: 1,
    policies: { auto_scale: false, auto_scale_max_supervisors: 6, auto_scale_max_workers: 3, keep_flowing_global: false, keep_flowing_workers: [], workers_suspended: false, workers_suspended_until: '', rate_limit_cooldown_minutes: 5, auto_scaled_supervisors: 0, auto_scaled_workers: 0 },
    limits: { min_supervisors: 1, max_supervisors: 6, min_workers: 1, max_workers: 6 },
    scheduler: { running: true, backend_reachable: true, last_refresh_at: '', last_error: '' },
    queue: { queued: 0, counts: {}, due: 0, scheduled: 0, blocked: 0, oldest_due_created_at: '', next_not_before: '' },
    provider: { provider: 'chatgpt', paused: false, paused_until: '', reason: '', updated_at: '' }, worker_pause: { paused: false, paused_until: '' },
    agents: [
      { id: 'supervisor-1', label: 'Supervisor 1', role: 'supervisor', status: 'idle', draining: false, chat_id: 'fixture-chat', project_id: '/workspace/atlas', error: '', browser: { available: true, web_contents_id: 1, url: 'https://chatgpt.com/c/fixture', title: 'Revisão do projeto Atlas', loading: false } },
      { id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'idle', draining: false, chat_id: '', error: '', browser: { available: false, web_contents_id: 0, url: '', title: '', loading: false } },
    ],
  }
  Object.assign(window.wharnessDesktop!, { agents: {
    state: async () => runtime, onState: () => () => {}, onMonitorSelect: () => () => {},
    presentInMonitor: async () => ({ ok: true }), resizeInMonitor: async () => ({ ok: true }), releaseFromMonitor: async () => ({ ok: true }),
  } })
}
