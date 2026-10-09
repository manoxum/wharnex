import test from 'node:test'
import assert from 'node:assert/strict'
import { behaviorProbeScript, normalizeBehaviorProbeResult } from '../dom/chatgpt-behavior-probe.mjs'

test('model-picker diagnosis is passive and follows only the model trigger explicit popup', () => {
  const script = behaviorProbeScript('model-picker')
  assert.match(script, /getAttribute\('aria-controls'\)/)
  assert.match(script, /document.getElementById\(popupId\)/)
  assert.doesNotMatch(script, /\.click\(|\.focus\(|querySelectorAll\('\[role="menu"\]/)
  assert.doesNotMatch(script, /document\.cookie|localStorage|sessionStorage|innerHTML|fetch\(/)
  const result = normalizeBehaviorProbeResult('model-picker', { viewport: { w: 1280, h: 900 }, options: 2, labels: [{ label: 'Account Alpha', selected: true, disabled: false, content: 'untrusted prose' }] })
  assert.deepEqual(result.labels, [{ label: 'Account Alpha', selected: true, disabled: false }])
})
