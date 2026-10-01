import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopAgentScheduling } from './index.mjs'

test('desktop scheduling keeps late browser bindings lazy and reads mutable state live', () => {
  const state = {
    chatAgentPolicies: { paused: false },
    desiredChatAgentWorkerSlots: 2,
    chatAgentRuntimeDiagnostics: { ready: true },
  }
  let lateReady = false
  let schedulingOptions
  let interactionOptions
  let refreshOptions
  const d = new Proxy({
    state,
    app: { getPath: () => '/profile', getAppMetrics: () => [] },
    chatGPTWorkerEntries: [], chatAgentWorkerStates: new Map(),
    createChatAgentPolicyStore: () => ({ load: () => ({}), persist: () => {} }),
    createKeepFlowingState: () => ({ configured: () => true, enabled: () => true, active: () => false, requestActive: () => false }),
    createChatAgentSchedulingOperations: (options) => {
      schedulingOptions = options
      return { reconcileChatGPTWorkerPool: () => {} }
    },
    createWorkerInteraction: (options) => { interactionOptions = options; return {} },
    createChatAgentRuntimeRefresh: (options) => { refreshOptions = options; return {} },
    getEphemeralAgentID: () => {
      if (!lateReady) throw new Error('late constant read during composition')
      return /^ephemeral-/
    },
    getEphemeralWorkerLabels: () => {
      if (!lateReady) throw new Error('late labels read during composition')
      return { RELEASE_NOTES: 'Release notes' }
    },
    buildChatAgentRuntimeState: (options) => options,
    projectAgentBrowser: () => ({}), sanitizeDiagnosticURL: (value) => value,
    chatAgentMemorySnapshot: () => ({}),
  }, { get: (target, key) => key in target ? target[key] : undefined })

  const runtime = createDesktopAgentScheduling(d)
  assert.equal(schedulingOptions.state.desiredChatAgentWorkerSlots, 2)
  state.desiredChatAgentWorkerSlots = 4
  assert.equal(schedulingOptions.state.desiredChatAgentWorkerSlots, 4)
  assert.equal(refreshOptions.state.diagnostics, state.chatAgentRuntimeDiagnostics)

  lateReady = true
  assert.equal(interactionOptions.isEphemeralAgentID('ephemeral-cat'), true)
  assert.equal(runtime.chatAgentRuntimeState().EPHEMERAL_WORKER_LABELS.RELEASE_NOTES, 'Release notes')
})
