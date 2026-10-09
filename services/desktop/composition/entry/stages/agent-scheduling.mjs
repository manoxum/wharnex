import { compose, late, provide } from '../../context/context.mjs'

export function composeAgentScheduling(ctx) {
  const { policyStore, keepFlowing } = compose(ctx, 'agent-scheduling', ctx.createDesktopAgentScheduling, {
    ...late(ctx, 'chatAgentRateLimitDelayMs', 'grantChatGPTLayoutViewport', 'supervisorKey', 'ensureChatGPTLayoutViewport'),
    agentRuntime: ctx.desktopState.agent,
    chatgptRuntime: ctx.desktopState.chatgpt,
    windowRuntime: ctx.desktopState.window,
    getEphemeralAgentID: () => ctx.EPHEMERAL_AGENT_ID,
    getEphemeralWorkerLabels: () => ctx.EPHEMERAL_WORKER_LABELS,
    supervisorEntry: () => ctx.supervisorEntry(),
  })
  provide(ctx, {
    loadChatAgentPolicies: policyStore.load,
    persistChatAgentPolicies: policyStore.persist,
    chatAgentKeepFlowingConfigured: keepFlowing.configured,
    chatAgentKeepFlowingEnabled: keepFlowing.enabled,
    chatAgentKeepFlowingActive: keepFlowing.active,
    chatAgentKeepFlowingRequestActive: keepFlowing.requestActive,
  }, 'agent-policies')
}

export function composeSupervisorSurfaces(ctx) {
  compose(ctx, 'supervisor-surfaces', ctx.createDesktopSupervisorSurfaces, {
    ...late(ctx, 'flushQueuedChatGPTComments'),
    navigationState: ctx.supervisorNavigationView,
  })
}
