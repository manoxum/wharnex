import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerInteraction } from './worker-interaction.mjs'

function fixture(activeTask = false) {
  const events = []
  const task = activeTask ? { task_id: 'busy', chat_id: 'otk-busy' } : undefined
  const entry = {
    slotId: 'worker-1', role: 'worker', ownerKey: 'otk-busy', ownerWindowId: 'win-1',
    parkedLayout: true, interactionWindowId: '',
    view: {
      webContents: { isDestroyed: () => false },
      setBounds: (bounds) => events.push(`bounds:${bounds.width}x${bounds.height}`),
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
  const otherWindowState = {
    id: 'win-2', activeAgentInteractionId: '',
    window: {
      getContentBounds: () => ({ width: 700, height: 500 }),
      contentView: { addChildView: () => events.push('attach-other'), removeChildView: () => events.push('detach-other') },
    },
  }
  const desktopWindows = new Map([['win-1', windowState], ['win-2', otherWindowState]])
  const chatAgentWorkerStates = new Map(activeTask ? [[1, { task }]] : [])
  const runtime = createWorkerInteraction({
    chatGPTWorkerEntries: [entry], isEphemeralAgentID: () => false, desktopWindows,
    windowStateForEntry: (candidate) => desktopWindows.get(candidate.ownerWindowId),
    grantChatGPTLayoutViewport: () => events.push('grant'),
    publishChatAgentRuntimeState: () => events.push('publish'), chatAgentWorkerStates,
    normalizeBounds: (bounds) => bounds?.width > 0 && bounds?.height > 0 ? bounds : undefined,
    reconcileChatGPTWorkerPool: () => events.push('reconcile'),
  })
  return { runtime, entry, windowState, otherWindowState, events, task, chatAgentWorkerStates }
}

test('active Worker task reuses its existing view in the embedded interaction surface', () => {
  const { runtime, entry, windowState, events, task, chatAgentWorkerStates } = fixture(true)
  const slotId = entry.slotId
  const ownerKey = entry.ownerKey

  assert.deepEqual(runtime.showChatAgentInteraction('worker-1', { width: 400, height: 300 }, windowState), {
    ok: true, agentId: 'worker-1', bounds: { width: 400, height: 300 },
  })
  assert.equal(entry.interactionWindowId, 'win-1')
  assert.equal(entry.ownerWindowId, 'win-1')
  assert.equal(entry.slotId, slotId)
  assert.equal(entry.ownerKey, ownerKey)
  assert.equal(chatAgentWorkerStates.get(1)?.task, task)
  // The real view stays in the browser host; the window only mirrors it.
  assert.deepEqual(events.slice(0, 3), ['bounds:400x300', 'visible:true', 'publish'])
})

test('a Worker presented in the browser monitor can also be mirrored in a project window', () => {
  const { runtime, entry, windowState, events } = fixture(true)
  entry.monitorWindowId = 'browser-monitor'

  assert.equal(runtime.showChatAgentInteraction('worker-1', { width: 400, height: 300 }, windowState).ok, true)
  assert.equal(entry.interactionWindowId, 'win-1')
  assert.equal(events.includes('attach'), false)
})

test('interaction bounds update only the active embedded view owned by the caller window', () => {
  const { runtime, entry, windowState, otherWindowState, events } = fixture(true)
  runtime.showChatAgentInteraction('worker-1', { width: 400, height: 300 }, windowState)

  assert.deepEqual(runtime.setChatAgentInteractionBounds('worker-1', { width: 520, height: 360 }, windowState), {
    ok: true, agentId: 'worker-1', bounds: { width: 520, height: 360 },
  })
  assert.equal(events.at(-1), 'bounds:520x360')
  const beforeRejected = events.length
  assert.deepEqual(runtime.setChatAgentInteractionBounds('worker-1', { width: 600, height: 400 }, otherWindowState), { ok: false, agentId: 'worker-1' })
  assert.equal(events.length, beforeRejected)

  windowState.activeAgentInteractionId = ''
  assert.deepEqual(runtime.setChatAgentInteractionBounds('worker-1', { width: 610, height: 410 }, windowState), { ok: false, agentId: 'worker-1' })
  windowState.activeAgentInteractionId = entry.slotId
  assert.throws(() => runtime.setChatAgentInteractionBounds('worker-1', { width: 0, height: 410 }, windowState), /bounds are invalid/)
})

test('closing embedded interaction detaches and parks the Worker without changing its task identity', () => {
  const { runtime, entry, windowState, events, task, chatAgentWorkerStates } = fixture(true)
  const slotId = entry.slotId
  const ownerKey = entry.ownerKey
  runtime.showChatAgentInteraction('worker-1', { width: 400, height: 300 }, windowState)

  assert.equal(runtime.closeChatAgentInteraction('worker-1', windowState).closed, true)
  assert.equal(entry.interactionWindowId, '')
  assert.equal(windowState.activeAgentInteractionId, '')
  assert.equal(entry.parkedLayout, true)
  assert.equal(entry.slotId, slotId)
  assert.equal(entry.ownerKey, ownerKey)
  assert.equal(chatAgentWorkerStates.get(1)?.task, task)
  assert.deepEqual(events.slice(-4), ['visible:false', 'grant', 'reconcile', 'publish'])
  assert.equal(events.includes('detach'), false)
})

test('unknown agent IDs cannot enter interaction mode', () => {
  const { runtime, windowState } = fixture()
  assert.throws(() => runtime.showChatAgentInteraction('supervisor-1', { width: 400, height: 300 }, windowState), /Only Worker/)
})
