import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerInteraction } from './worker-interaction.mjs'

function fixture(activeTask = false) {
  const events = []
  const entry = {
    slotId: 'worker-1', role: 'worker', attached: false,
    view: {
      webContents: { isDestroyed: () => false },
      setBounds: (bounds) => events.push(`bounds:${bounds.width}`),
      setVisible: (visible) => events.push(`visible:${visible}`),
    },
  }
  const windowState = {
    id: 'win-1', activeAgentInteractionId: '',
    window: {
      getContentBounds: () => ({ width: 800, height: 600 }),
      contentView: {
        addChildView: () => events.push('attach'),
        removeChildView: () => events.push('detach'),
      },
    },
  }
  const runtime = createWorkerInteraction({
    chatGPTWorkerEntries: [entry], isEphemeralAgentID: () => false,
    desktopWindows: new Map([['win-1', windowState]]),
    windowStateForEntry: () => windowState,
    grantChatGPTLayoutViewport: () => events.push('grant'),
    publishChatAgentRuntimeState: () => events.push('publish'),
    chatAgentWorkerStates: new Map(activeTask ? [[1, { task: { task_id: 'busy' } }]] : []),
    normalizeBounds: (bounds) => bounds,
    reconcileChatGPTWorkerPool: () => events.push('reconcile'),
  })
  return { runtime, entry, windowState, events }
}

test('active Worker task keeps its renderer out of the interaction pane', () => {
  const { runtime, windowState, events } = fixture(true)
  assert.throws(() => runtime.showChatAgentInteraction('worker-1', { width: 400 }, windowState), /a executar uma tarefa/)
  assert.deepEqual(events, [])
})

test('explicit interaction attaches the Worker and close restores its parked viewport', () => {
  const { runtime, entry, windowState, events } = fixture()
  assert.equal(runtime.showChatAgentInteraction('worker-1', { width: 400 }, windowState).ok, true)
  assert.equal(entry.interactionWindowId, 'win-1')
  assert.deepEqual(events.slice(0, 3), ['attach', 'bounds:400', 'visible:true'])
  assert.equal(runtime.closeChatAgentInteraction('worker-1', windowState).closed, true)
  assert.equal(entry.interactionWindowId, '')
  assert.deepEqual(events.slice(-5), ['visible:false', 'detach', 'grant', 'reconcile', 'publish'])
})

test('unknown agent IDs cannot enter interaction mode', () => {
  const { runtime, windowState } = fixture()
  assert.throws(() => runtime.showChatAgentInteraction('supervisor-1', { width: 400 }, windowState), /Only Worker/)
})
