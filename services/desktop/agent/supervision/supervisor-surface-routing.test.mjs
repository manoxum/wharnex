import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { publicSupervisorId, supervisorSurfaceRoute } from './supervisor-surface-routing.mjs'

const supervisors = [
  { key: 'chat-uploading', slotId: 'supervisor-1' },
  { key: 'chat-visible', slotId: 'supervisor-2' },
]

test('an upload on one browser instance does not cover a chat resident on another', () => {
  const route = supervisorSurfaceRoute({
    targetKey: 'chat-visible',
    supervisors,
    capacity: 3,
    activeTransportKey: 'chat-uploading',
    activeTransportSlotId: 'supervisor-1',
  })

  assert.deepEqual(route, {
    deferred: false,
    reason: 'resident',
    supervisorId: 'supervisor-2',
  })
})

test('an upload does not consume a different free Supervisor instance', () => {
  const route = supervisorSurfaceRoute({
    targetKey: 'chat-new',
    supervisors,
    capacity: 3,
    activeTransportKey: 'chat-uploading',
    activeTransportSlotId: 'supervisor-1',
  })

  assert.equal(route.deferred, false)
  assert.equal(route.reason, 'free-slot')
})

test('a chat still waits when every physical Supervisor is held', () => {
  const route = supervisorSurfaceRoute({
    targetKey: 'chat-new',
    supervisors: [...supervisors, { key: 'chat-held', slotId: 'supervisor-3' }],
    capacity: 3,
    activeTransportKey: 'chat-uploading',
    activeTransportSlotId: 'supervisor-1',
  })

  assert.deepEqual(route, {
    deferred: true,
    reason: 'transport',
    competingKey: 'chat-uploading',
    competingSupervisorId: 'supervisor-1',
  })
})

test('a free reusable instance is independent from another instance upload', () => {
  const route = supervisorSurfaceRoute({
    targetKey: 'chat-new',
    supervisors: [...supervisors, { key: 'chat-reusable', slotId: 'supervisor-3' }],
    capacity: 3,
    reusableKey: 'chat-reusable',
    activeTransportKey: 'chat-uploading',
    activeTransportSlotId: 'supervisor-1',
  })

  assert.equal(route.deferred, false)
  assert.equal(route.supervisorId, 'supervisor-3')
})

test('only a canonical physical Supervisor id crosses the renderer boundary', () => {
  assert.equal(publicSupervisorId({ slotId: 'supervisor-2' }), 'supervisor-2')
  assert.equal(publicSupervisorId({ slotId: 'worker-2' }), '')
  assert.equal(publicSupervisorId({ slotId: 'Supervisor 2' }), '')
})

test('the public ChatGPT state carries the owning physical Supervisor id', async () => {
  const source = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../../composition/session/view-health-runtime.mjs', import.meta.url), 'utf8')
  const viewState = await readFile(new URL('../../chatgpt/session/views/state.mjs', import.meta.url), 'utf8')
  assert.match(source, /createDesktopChatViewHealthRuntime\(\{/)
  assert.match(runtime, /createChatGPTViewState\(\{/)
  assert.match(viewState, /supervisorId: publicSupervisorId\(entry\)/)
})
