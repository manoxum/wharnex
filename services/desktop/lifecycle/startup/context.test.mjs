import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopStartupContext } from './index.mjs'

test('startup context keeps mutable policies, scheduler assignments and quit status live', () => {
  const state = {
    policies: { marker: 'initial' },
    dueTranslations: 0,
    quitting: false,
  }
  const workerFactory = () => ({ start() {} })
  const deps = new Proxy({ state, createWorkerScheduler: workerFactory }, {
    get(target, key) { return key in target ? target[key] : () => {} },
  })
  const context = createDesktopStartupContext(deps)
  assert.equal(context.worker.create, workerFactory)
  assert.equal(context.worker.options.getChatAgentPolicies(), state.policies)
  state.policies = { marker: 'updated' }
  assert.equal(context.worker.options.getChatAgentPolicies().marker, 'updated')
  context.setChatAgentPolicies({ marker: 'loaded' })
  assert.equal(state.policies.marker, 'loaded')
  const scheduler = workerFactory()
  context.worker.assign(scheduler)
  assert.equal(state.workerScheduler, scheduler)
  state.dueTranslations = 2
  assert.equal(context.translator.options.getDueChatTranslations(), 2)
  state.quitting = true
  assert.equal(context.worker.isQuitting(), true)
})
