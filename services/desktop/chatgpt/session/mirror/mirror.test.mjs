import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectSurfaceMirror } from './frames.mjs'
import { dispatchMirrorInput, sanitizeMirrorInput } from './input.mjs'

function window(sent, { visible = true, minimized = false } = {}) {
  return {
    isDestroyed: () => false, isVisible: () => visible, isMinimized: () => minimized,
    webContents: { isDestroyed: () => false, send: (channel, payload) => sent.push([channel, payload]) },
  }
}

function surface(frames, calls = []) {
  let index = 0
  return {
    isVisible: () => true,
    paint: () => calls.push('paint'),
    webContents: {
      isDestroyed: () => false,
      capturePage: async (_rect, options) => {
        calls.push(`capture:${options.stayHidden}`)
        const frame = frames[Math.min(index++, frames.length - 1)]
        if (frame instanceof Error) throw frame
        return { isEmpty: () => false, getSize: () => ({ width: 900, height: 700 }), toJPEG: () => Buffer.from(frame) }
      },
    },
  }
}

test('mirrors each project window its own Supervisor and surfaced Worker only', async () => {
  const sent = []
  const project = { id: 'project', window: window(sent), activeChatGPTKey: 'chat-1', activeAgentInteractionId: 'worker-1' }
  const other = { id: 'other', window: window([], { minimized: true }), activeChatGPTKey: 'chat-2' }
  const monitor = { id: 'browser-monitor', window: window([]), activeChatGPTKey: 'chat-1' }
  const supervisor = { ownerWindowId: 'project', view: surface(['a']) }
  const foreign = { ownerWindowId: 'other', view: surface(['b']) }
  const worker = { slotId: 'worker-1', interactionWindowId: 'project', view: surface(['w']) }
  const mirror = createProjectSurfaceMirror({
    desktopWindows: new Map([['project', project], ['other', other], ['browser-monitor', monitor]]),
    chatgptViews: new Map([['chat-1', supervisor], ['chat-2', foreign]]), chatGPTWorkerEntries: [worker],
  })
  assert.deepEqual(mirror.mirrorTargets().map((target) => [target.state.id, target.channel]), [
    ['project', 'wharness:chatgpt:mirror-frame'], ['project', 'wharness:agents:mirror-frame'],
  ])
  mirror.tick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(sent.map(([channel, frame]) => [channel, frame.cacheKey || frame.agentId, String(frame.data)]), [
    ['wharness:chatgpt:mirror-frame', 'chat-1', 'a'], ['wharness:agents:mirror-frame', 'worker-1', 'w'],
  ])
})

test('an unchanged frame is not resent and a missing surface is repainted', async () => {
  const sent = []
  const calls = []
  const project = { id: 'project', window: window(sent), activeChatGPTKey: 'chat-1' }
  const supervisor = { ownerWindowId: 'project', view: surface([new Error('UnknownVizError'), 'a', 'a', 'b'], calls) }
  const mirror = createProjectSurfaceMirror({ desktopWindows: new Map([['project', project]]), chatgptViews: new Map([['chat-1', supervisor]]), chatGPTWorkerEntries: [] })
  for (let round = 0; round < 4; round += 1) {
    mirror.tick()
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.deepEqual(calls, ['capture:true', 'paint', 'capture:true', 'capture:true', 'capture:true'])
  assert.deepEqual(sent.map(([, frame]) => String(frame.data)), ['a', 'b'])
})

test('mirror input is a closed vocabulary with page-derived text', () => {
  assert.deepEqual(sanitizeMirrorInput({ type: 'mousePressed', nx: 2, ny: -1, button: 'left', clickCount: 9, modifiers: 99 }), {
    type: 'mousePressed', modifiers: 15, button: 'left', nx: 1, ny: 0, buttons: 0, clickCount: 3, deltaX: 0, deltaY: 0,
  })
  assert.throws(() => sanitizeMirrorInput({ type: 'navigate', url: 'https://example.com' }), /inválido/)
  assert.throws(() => sanitizeMirrorInput({ type: 'keyDown', key: 'a', code: 'Key-A' }), /inválida/)
})

test('mirror input reaches the view over the debugger in page coordinates', async () => {
  const commands = []
  let attached = false
  const wc = {
    isDestroyed: () => false, getZoomFactor: () => 0.5,
    debugger: {
      isAttached: () => attached, attach: () => { attached = true }, detach: () => { attached = false },
      sendCommand: async (method, params) => { commands.push([method, params]) },
    },
  }
  const entry = { view: { webContents: wc, native: { getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }) } } }
  await dispatchMirrorInput(entry, { type: 'mousePressed', nx: 0.5, ny: 0.25, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 })
  await dispatchMirrorInput(entry, { type: 'keyDown', key: 'v', code: 'KeyV', keyCode: 86, modifiers: 2 })
  await dispatchMirrorInput(entry, { type: 'keyDown', key: 'é', code: '', keyCode: 0, modifiers: 0 })
  assert.equal(attached, true)
  assert.deepEqual(commands[1], ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 1000, y: 400, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 }])
  assert.deepEqual(commands[3][1].commands, ['paste'])
  assert.equal(commands[3][1].type, 'rawKeyDown')
  assert.equal(commands[3][1].text, undefined)
  assert.deepEqual([commands[5][1].type, commands[5][1].text], ['keyDown', 'é'])
})
