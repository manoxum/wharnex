import { compose, late } from '../../context/context.mjs'
import { createDesktopChatWorkflowRuntime } from '../../session/index.mjs'

export function composeChatWorkflow(ctx) {
  const deferred = late(ctx,
    'clearChatGPTHumanAction', 'refreshChatAgentRuntimeState', 'enqueueChatAgentTask',
    'hideChatAgentInteractionsForWindow', 'grantChatGPTLayoutViewport', 'retireChatGPTSupervisorSurface',
    'cancelExternalAuthentication', 'waitForConcreteChatGPTConversation', 'recordChatGPTTaskEvent')
  const { desktopState } = ctx
  compose(ctx, 'chat-workflow', createDesktopChatWorkflowRuntime, {
    ...deferred,
    hideAgentInteractionsForWindow: deferred.hideChatAgentInteractionsForWindow,
    rateState: ctx.rateLimitView,
    scheduler: ctx.getScheduler,
    recentDownload: () => desktopState.chatgpt.recentExpectedDownload,
    tempPath: () => ctx.app.getPath('temp'),
    recordProviderDiagnostics: (provider) => {
      desktopState.agent.chatAgentRuntimeDiagnostics.provider = { ...desktopState.agent.chatAgentRuntimeDiagnostics.provider, ...provider }
      ctx.publishChatAgentRuntimeState()
    },
  })
}
