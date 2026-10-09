import test from 'node:test'
import assert from 'node:assert/strict'
import { readComposedDesktopContext } from './composed.mjs'

test('the Desktop composes outside Electron with every stage output provided once', async () => {
  const context = await readComposedDesktopContext()
  assert.equal(context.desktopEntrypoint, 'object:Object')
  assert.equal(context.browserHost, 'object:Object')
  assert.equal(context.desktopState, 'object:Object')
})

test('every late dependency a stage defers is provided by a later stage', async () => {
  const context = await readComposedDesktopContext()
  const deferred = [
    'publishChatAgentRuntimeState', 'publishChatGPTState', 'chatAgentRuntimeState', 'sendToWindowState',
    'refreshDesktopTray', 'persistChatAgentPolicies', 'hasPendingChatGPTComments', 'requireOwnedChatGPTEntry',
    'ensureChatGPTView', 'hideChatAgentInteractionsForWindow', 'clearChatGPTHumanAction',
    'refreshChatAgentRuntimeState', 'enqueueChatAgentTask', 'grantChatGPTLayoutViewport',
    'retireChatGPTSupervisorSurface', 'cancelExternalAuthentication', 'waitForConcreteChatGPTConversation',
    'recordChatGPTTaskEvent', 'chatGPTSurfaceShouldBeVisible', 'chatAgentRateLimitDelayMs', 'supervisorKey',
    'ensureChatGPTLayoutViewport', 'flushQueuedChatGPTComments', 'durableWorkspaceChatID',
    'persistWorkspaceChatRemoteBestEffort', 'enqueueChatAgentFollowups', 'applyDeferredSupervisorNavigation',
    'persistWindowLayout', 'pauseChatAgentWorkers', 'supervisorEntry', 'pollExpectedChatGPTDownloadKey',
    'hideChatGPTSidebar', 'hideChatAgentInteractionEntry', 'performChatGPTRecoveryAction', 'recordChatGPTContinuationSent',
  ]
  for (const name of deferred) assert.equal(context[name], 'function', name)
})
