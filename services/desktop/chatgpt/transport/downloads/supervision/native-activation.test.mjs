import test from 'node:test'
import assert from 'node:assert/strict'
import { createExpectedDownloadNativeActivation } from './native-activation.mjs'
import { createAccountControls } from '../../../account/control/index.mjs'

function fixture() {
  const calls = []
  const expected = { requestId: 'req-owned', filename: 'response.zip', armedAt: Date.now() }
  const target = { kind: 'exact-role-link', rect: { x: 30, y: 40 }, viewport: { width: 800, height: 600 } }
  const wc = { getURL: () => 'https://chatgpt.com/c/owned', isDestroyed: () => false, executeJavaScript: async () => { calls.push('locate'); return target } }
  const entry = { ownerKey: 'owned', view: { webContents: wc, getVisible: () => true } }
  const context = { expectedChatGPTBundles: new Map([['owned', expected]]), chatgptViews: new Map([['owned', entry]]), chatgptTransportModes: new Map(), hasPendingChatGPTComments: () => false, pendingChatGPTBundleDeliveries: new Map(), recentlyDeliveredChatGPTBundleRequestId: () => false, chatGPTSupervisorOwnsExpectedResponse: () => true, requireOwnedChatGPTEntry: () => ({ wc }), isTrustedChatGPTOrigin: () => true, pressChatGPTControl: async (_entry, _wc, point) => { calls.push(['press', point]); return point }, EXPECTED_BUNDLE_TTL_MS: 60_000 }
  return { calls, expected, target, wc, entry, context, activate: createExpectedDownloadNativeActivation(context) }
}
const selected = { mode: 'exact', nativeTarget: { kind: 'exact-role-link' } }

test('a named exact role-link target is freshly located and committed through native input', async () => {
  const f = fixture()
  assert.equal(await f.activate('owned', f.entry, f.expected, selected), true)
  assert.deepEqual(f.calls, ['locate', ['press', { x: 30, y: 40 }]])
})

test('expectation or slot changes while locating cannot dispatch stale coordinates', async () => {
  for (const mutate of [(f) => f.context.expectedChatGPTBundles.set('owned', { ...f.expected }), (f) => f.context.chatgptViews.set('owned', { ...f.entry }), (f) => { f.entry.transportPreparationCount = 1 }]) {
    const f = fixture()
    f.wc.executeJavaScript = async () => { f.calls.push('locate'); mutate(f); return f.target }
    assert.equal(await f.activate('owned', f.entry, f.expected, selected), false)
    assert.deepEqual(f.calls, ['locate'])
  }
})

test('invalid or offscreen points, manual/login/delivery guards and failed native input fail closed', async () => {
  for (const mutate of [(f) => { f.target.rect.x = 900 }, (f) => { f.target.rect.x = NaN }, (f) => { f.target.kind = 'arbitrary' }, (f) => f.context.chatgptTransportModes.set('owned', 'manual'), (f) => { f.entry.externalAuthProvider = true }, (f) => f.context.pendingChatGPTBundleDeliveries.set(f.expected.requestId, {}), (f) => { f.context.pressChatGPTControl = async () => { throw new Error('input unavailable') } }]) {
    const f = fixture()
    mutate(f)
    assert.equal(await createExpectedDownloadNativeActivation(f.context)('owned', f.entry, f.expected, selected), false)
    assert.equal(f.calls.some((call) => Array.isArray(call)), false)
  }
})

test('hidden page input is scoped and rechecks ownership after focus emulation awaits', async () => {
  const f = fixture()
  f.entry.view.getVisible = () => false
  f.wc.debugger = { isAttached: () => false, attach: () => f.calls.push('attach'), detach: () => f.calls.push('detach'), sendCommand: async (method, params) => { f.calls.push([method, params.enabled]); if (params.enabled) f.context.expectedChatGPTBundles.delete('owned') } }
  assert.equal(await f.activate('owned', f.entry, f.expected, selected), false)
  assert.deepEqual(f.calls, ['attach', ['Emulation.setFocusEmulationEnabled', true], ['Emulation.setFocusEmulationEnabled', false], 'detach'])
})

test('the hidden native commit uses trusted renderer mouse events and never focuses WebContents', async () => {
  const f = fixture()
  let attached = false
  f.entry.view.getVisible = () => false
  f.wc.focus = () => { throw new Error('remote focus is forbidden') }
  f.wc.debugger = { isAttached: () => attached, attach: () => { attached = true }, detach: () => { attached = false }, sendCommand: async (method, params) => { f.calls.push([method, params.type || params.enabled]) } }
  const controls = createAccountControls({ wait: async () => {}, CHATGPT_CONTROL_PRESS_HOLD_MS: 0 })
  f.context.pressChatGPTControl = controls.pressChatGPTControl
  assert.equal(await createExpectedDownloadNativeActivation(f.context)('owned', f.entry, f.expected, selected), true)
  assert.deepEqual(f.calls, [['Emulation.setFocusEmulationEnabled', true], 'locate', ['Input.dispatchMouseEvent', 'mouseMoved'], ['Input.dispatchMouseEvent', 'mousePressed'], ['Input.dispatchMouseEvent', 'mouseReleased'], ['Emulation.setFocusEmulationEnabled', false]])
  assert.equal(attached, false)
})
