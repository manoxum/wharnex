import { compose, late } from '../../context/context.mjs'
import { createDesktopChatGPTTransportStage } from '../../transport/index.mjs'

export function composeTransport(ctx) {
  compose(ctx, 'chatgpt-transport', createDesktopChatGPTTransportStage, {
    ...late(ctx, 'durableWorkspaceChatID', 'persistWorkspaceChatRemoteBestEffort', 'enqueueChatAgentFollowups', 'enqueueChatAgentTask'),
    rateLimitState: ctx.rateLimitView,
  })
  compose(ctx, 'workspace-chat-remote', ctx.createWorkspaceChatRemote)
  compose(ctx, 'agent-task-queue', ctx.createChatAgentTaskQueue)
  compose(ctx, 'agent-followups', ctx.createChatAgentFollowups)
}
