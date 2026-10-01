import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostedChatGPTSurface } from './surface.mjs'

function fixture() {
  const events = []
  let destroyed
  const native = {
    visible: true,
    webContents: { isDestroyed: () => false, once: (_name, callback) => { destroyed = callback } },
    setVisible(value) { this.visible = value; events.push(`native:visible:${value}`) },
    getVisible() { return this.visible },
    setBounds: (bounds) => events.push(`native:bounds:${bounds.x},${bounds.y},${bounds.width}x${bounds.height}`),
    setBackgroundColor: () => undefined,
  }
  class View {
    constructor() { this.bounds = { x: 0, y: 0, width: 0, height: 0 } }
    addChildView() { events.push('box:add-content') }
    setBounds(bounds) { this.bounds = bounds; events.push(`box:bounds:${bounds.x},${bounds.y},${bounds.width}x${bounds.height}`) }
    getBounds() { return this.bounds }
  }
  const host = { attach: () => events.push('host:attach'), detach: () => events.push('host:detach') }
  const monitor = {
    isDestroyed: () => false,
    contentView: { addChildView: () => events.push('monitor:add'), removeChildView: () => events.push('monitor:remove') },
  }
  const surface = createHostedChatGPTSurface(native, { View, host })
  return { surface, native, monitor, events, destroy: () => destroyed() }
}

test('project pane bounds size the parked view at the host origin and never show it', () => {
  const { surface, native, events } = fixture()
  events.length = 0
  surface.setVisible(true)
  surface.setBounds({ x: 400, y: 120, width: 900, height: 700 })
  assert.equal(surface.isVisible(), true)
  assert.equal(surface.getVisible(), false)
  assert.deepEqual(surface.getBounds(), { x: 400, y: 120, width: 900, height: 700 })
  assert.deepEqual(events, ['native:visible:true', 'native:bounds:0,0,900x700', 'box:bounds:0,0,900x700', 'native:visible:false'])
  assert.equal(native.visible, false)
  events.length = 0
  surface.setBounds({ x: 10, y: 10, width: 900, height: 700 })
  assert.deepEqual(events, [])
})

test('presenting sizes the real view while its container is out of any window', () => {
  const { surface, monitor, events } = fixture()
  surface.setBounds({ x: 0, y: 0, width: 900, height: 700 })
  events.length = 0
  surface.present(monitor, { x: 300, y: 120, width: 600, height: 500 })
  assert.deepEqual(events, ['host:detach', 'native:bounds:0,0,600x500', 'native:visible:true', 'monitor:add', 'box:bounds:300,120,600x500'])
  assert.equal(surface.getVisible(), true)
  events.length = 0
  surface.resizePresented({ x: 300, y: 120, width: 500, height: 500 })
  assert.deepEqual(events, ['monitor:remove', 'native:bounds:0,0,500x500', 'monitor:add', 'box:bounds:300,120,500x500'])
  events.length = 0
  surface.resizePresented({ x: 310, y: 130, width: 500, height: 500 })
  assert.deepEqual(events, ['box:bounds:310,130,500x500'])
})

test('releasing parks the view back at the host origin at the project pane size', () => {
  const { surface, monitor, events } = fixture()
  surface.setBounds({ x: 0, y: 0, width: 900, height: 700 })
  surface.present(monitor, { x: 300, y: 120, width: 600, height: 500 })
  events.length = 0
  surface.release()
  assert.deepEqual(events, ['native:visible:false', 'monitor:remove', 'host:attach', 'native:visible:true', 'native:bounds:0,0,900x700', 'box:bounds:0,0,900x700', 'native:visible:false'])
  assert.equal(surface.getVisible(), false)
})

test('a closed renderer leaves the host and the monitor', () => {
  const { surface, monitor, events, destroy } = fixture()
  surface.present(monitor, { x: 300, y: 120, width: 600, height: 500 })
  events.length = 0
  destroy()
  assert.deepEqual(events, ['monitor:remove', 'host:detach'])
})
