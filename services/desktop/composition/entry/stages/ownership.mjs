import { compose, late } from '../../context/context.mjs'
import { createDesktopOwnershipRuntime } from '../../session/index.mjs'
import { createDesktopWindowAssembly } from '../../window/index.mjs'

// Windows are created by the entry point runtime, composed last.
export function createWindowLater(ctx) {
  return (...args) => ctx.desktopEntrypoint.createWindow(...args)
}

export function composeOwnership(ctx) {
  const deferred = late(ctx, 'hasPendingChatGPTComments', 'requireOwnedChatGPTEntry', 'ensureChatGPTView')
  compose(ctx, 'ownership', createDesktopOwnershipRuntime, {
    hasPendingChatGPTComments: deferred.hasPendingChatGPTComments,
    requireOwnedEntry: deferred.requireOwnedChatGPTEntry,
    ensureChatGPTView: deferred.ensureChatGPTView,
    deferredNavigationPending: () => Boolean(ctx.desktopState.chatgpt.deferredSupervisorNavigation),
    applyDeferredNavigation: () => ctx.applyDeferredSupervisorNavigation(),
  })
}

export function composeWindowAssembly(ctx) {
  const deferred = late(ctx, 'chatAgentRuntimeState', 'hideChatAgentInteractionsForWindow')
  compose(ctx, 'window-assembly', createDesktopWindowAssembly, {
    chatAgentRuntimeState: deferred.chatAgentRuntimeState,
    platform: process.platform,
    pauseChatAgentWorkers: () => ctx.pauseChatAgentWorkers({}),
    userDataPath: () => ctx.app.getPath('userData'),
    displays: () => ctx.screen.getAllDisplays(),
    refreshDesktopTray: () => ctx.refreshDesktopTray(),
    persistWindowLayout: () => ctx.persistWindowLayout(),
    createWindow: createWindowLater(ctx),
    hideAgentInteractionsForWindow: deferred.hideChatAgentInteractionsForWindow,
  })
}
