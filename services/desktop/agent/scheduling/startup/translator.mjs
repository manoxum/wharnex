export function createTranslatorScheduler({
  ChatAgentSchedulerClient, BACKEND_URL, MAX_TRANSLATOR_SLOTS,
  withTrace, traceForTask, executeEphemeralWorkerTask, desktopWindows,
  getDueChatTranslations, projectWindowRegistry, activeChatTranslatorSlots,
}) {
  return new ChatAgentSchedulerClient({
    baseURL: BACKEND_URL, workerCount: 1, maxWorkers: MAX_TRANSLATOR_SLOTS,
    execute: (task, context) => withTrace(traceForTask(task), () => executeEphemeralWorkerTask(task, context)), role: 'translator', agentID: (index) => `translator-${index}`,
    idleMs: 100, taskCooldownMs: 0,
    claimOptions: () => ({
      // Unlike persistent pools, the ephemeral consumer claims after a
      // cooldown's durable deadline even while the Desktop still awaits its
      // health confirmation. Its executor then answers locally at the resume
      // gate without touching ChatGPT.
      skip: ![...desktopWindows.values()].some((state) => state.window && !state.window.isDestroyed()) || getDueChatTranslations() === 0,
      project_scoped: true, open_projects: projectWindowRegistry.openProjects(),
    }),
    onState: (state) => {
      if (state?.kind === 'running') activeChatTranslatorSlots.add(state.worker)
      if (state?.kind === 'settled' || state?.kind === 'task-error' || state?.kind === 'worker-stopped') activeChatTranslatorSlots.delete(state.worker)
      if (state?.kind === 'task-error' || state?.kind === 'worker-error') {
        console.warn(`[translator] ${state.kind}: ${String(state?.error?.message || state?.error || 'unknown failure')}`)
      }
    },
  })
}
