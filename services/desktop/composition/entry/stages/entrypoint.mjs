import { compose } from '../../context/context.mjs'
import { createDesktopEntrypointRuntime } from '../runtime.mjs'

export function composeEntrypoint(ctx) {
  const { desktopState } = ctx
  compose(ctx, 'entrypoint', (deps) => ({ desktopEntrypoint: createDesktopEntrypointRuntime(deps) }), {
    logger: console,
    // A Worker's own window is now the browser monitor, with that Worker selected.
    openWorkerMonitor: (entry) => {
      const alreadyOpen = Boolean(ctx.desktopWindows.get('browser-monitor'))
      ctx.browserHost.open(entry?.slotId)
      return { ok: true, agentId: entry?.slotId || '', alreadyOpen }
    },
    getFocusedWindow: () => ctx.BrowserWindow.getFocusedWindow(),
    getDownloadPoller: () => desktopState.chatgpt.chatGPTDownloadPoller,
    get desiredChatAgentWorkerSlots() { return desktopState.agent.desiredChatAgentWorkerSlots },
    get desiredChatAgentSupervisorSlots() { return desktopState.agent.desiredChatAgentSupervisorSlots },
    agentState: ctx.agentRuntimeView,
    state: ctx.agentRuntimeView,
  })
}
