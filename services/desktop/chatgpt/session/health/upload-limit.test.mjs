import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createChatGPTUploadLimitGate, ChatGPTUploadLimitDeferral, UPLOAD_LIMIT_WINDOWS_MS,
  UPLOAD_LIMIT_PROBE_WAIT_MS, chatGPTUploadAffordanceScript, uploadAffordanceDisabled,
} from './upload-limit.mjs'

function gate() {
  let clock = 1_000_000
  const persisted = []
  const instance = createChatGPTUploadLimitGate({ now: () => clock, persist: (value) => persisted.push(value), log: () => {} })
  return { instance, persisted, advance: (ms) => { clock += ms } }
}

test('one transient no-start does not open the gate; a confirmed upload resets the count', () => {
  const { instance, persisted } = gate()
  assert.equal(instance.noteNotStarted(3), null)
  instance.noteConfirmed()
  assert.equal(instance.noteNotStarted(4), null)
  assert.deepEqual(instance.admit(5), { allowed: true, probe: false })
  assert.equal(persisted.length, 0)
})

test('two consecutive no-starts from any surface open the account gate and defer for free', () => {
  const { instance, persisted } = gate()
  instance.noteNotStarted(3)
  const deferral = instance.noteNotStarted(5)
  assert.ok(deferral instanceof ChatGPTUploadLimitDeferral)
  assert.equal(deferral.retryUpload, false)
  assert.equal(deferral.freeDeferral, true)
  assert.equal(deferral.delayMs, UPLOAD_LIMIT_WINDOWS_MS[0])
  const denied = instance.admit(8)
  assert.equal(denied.allowed, false)
  assert.equal(denied.delayMs, UPLOAD_LIMIT_WINDOWS_MS[0])
  assert.equal(persisted.at(-1).active, true)
  assert.equal(persisted.at(-1).level, 1)
})

test('structural evidence opens the gate on the first no-start', () => {
  const { instance } = gate()
  assert.ok(instance.noteNotStarted(3, { structural: true }) instanceof ChatGPTUploadLimitDeferral)
  assert.equal(instance.snapshot().reason, 'structural-upload-disabled')
})

test('after the window exactly one probe runs; its failure widens the window', () => {
  const { instance, advance } = gate()
  instance.noteNotStarted(3)
  instance.noteNotStarted(3)
  advance(UPLOAD_LIMIT_WINDOWS_MS[0])
  assert.deepEqual(instance.admit(7), { allowed: true, probe: true })
  assert.deepEqual(instance.admit(9), { allowed: false, delayMs: UPLOAD_LIMIT_PROBE_WAIT_MS })
  const reopened = instance.noteNotStarted(7)
  assert.equal(reopened.delayMs, UPLOAD_LIMIT_WINDOWS_MS[1])
  assert.equal(instance.snapshot().level, 2)
})

test('the window never grows past the provider two-hour horizon', () => {
  const { instance, advance } = gate()
  instance.noteNotStarted(1, { structural: true })
  for (let level = 1; level < 9; level += 1) {
    advance(UPLOAD_LIMIT_WINDOWS_MS.at(-1))
    instance.admit(1)
    instance.noteNotStarted(1)
  }
  assert.equal(instance.snapshot().level > UPLOAD_LIMIT_WINDOWS_MS.length, true)
  assert.equal(instance.admit(2).delayMs, UPLOAD_LIMIT_WINDOWS_MS.at(-1))
})

test('a confirmed probe, an account change or an operator release closes the gate', () => {
  for (const close of [(g) => g.noteConfirmed(), (g) => g.release('account-changed'), (g) => g.release('operator')]) {
    const { instance, persisted, advance } = gate()
    instance.noteNotStarted(3, { structural: true })
    advance(UPLOAD_LIMIT_WINDOWS_MS[0])
    instance.admit(3)
    close(instance)
    assert.deepEqual(instance.admit(4), { allowed: true, probe: false })
    assert.equal(persisted.at(-1).active, false)
  }
})

test('a persisted hold is adopted and never shortened; a later release closes it', () => {
  const { instance, advance } = gate()
  const until = new Date(1_000_000 + 30 * 60_000).toISOString()
  instance.adopt({ active: true, until, level: 2, reason: 'consecutive-not-started' })
  assert.equal(instance.admit(1).delayMs, 30 * 60_000)
  instance.adopt({ active: true, until: new Date(1_000_000 + 60_000).toISOString(), level: 1 })
  assert.equal(instance.admit(1).delayMs, 30 * 60_000)
  instance.noteNotStarted(1, { structural: true })
  instance.adopt({ active: false, updated_at: new Date(1_000_000 - 1).toISOString() })
  assert.equal(instance.snapshot().active, true, 'an older inactive record raced the gate and is ignored')
  advance(1_000)
  instance.adopt({ active: false, updated_at: new Date(1_000_000 + 1_000).toISOString() })
  assert.equal(instance.snapshot().active, false)
})

test('the affordance probe is a pure structural script', () => {
  const script = chatGPTUploadAffordanceScript()
  assert.doesNotThrow(() => new Function(`return ${script}`))
  assert.doesNotMatch(script, /textContent|innerText|innerHTML/)
  assert.equal(uploadAffordanceDisabled({ found: true, inputs: 3, inputsDisabled: 3, triggers: 1, triggersDisabled: 0 }), true)
  assert.equal(uploadAffordanceDisabled({ found: true, inputs: 3, inputsDisabled: 1, triggers: 1, triggersDisabled: 1 }), true)
  assert.equal(uploadAffordanceDisabled({ found: true, inputs: 3, inputsDisabled: 1, triggers: 0, triggersDisabled: 0 }), false)
  assert.equal(uploadAffordanceDisabled({ found: false }), false)
})
