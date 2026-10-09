import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, createCompositionContext, late, provide } from './context.mjs'

test('a stage provides names once and repeating the same value is harmless', () => {
  const shared = () => 'shared'
  const context = createCompositionContext({ shared })
  provide(context, { shared, own: 1 }, 'stage')
  assert.equal(context.shared, shared)
  assert.equal(context.own, 1)
})

test('redefining a provided name with another value fails with the stage name', () => {
  const context = createCompositionContext({ publish: () => 'one' })
  assert.throws(() => provide(context, { publish: () => 'two' }, 'window'), /window redefines 'publish'/)
})

test('provided accessors stay live instead of being snapshotted', () => {
  const state = { value: 1 }
  const context = createCompositionContext()
  provide(context, { get current() { return state.value } }, 'state')
  state.value = 2
  assert.equal(context.current, 2)
})

test('compose provides new outputs, skips echoed inputs and keeps override accessors live', () => {
  const echo = () => 'echo'
  const context = createCompositionContext({ echo })
  let slots = 1
  let seen
  const output = compose(context, 'stage', (input) => {
    seen = input
    return { echo: input.echo, created: () => input.slots }
  }, { get slots() { return slots } })
  slots = 3
  assert.equal(output.created(), 3)
  assert.equal(context.created, output.created)
  assert.equal(context.echo, echo)
  assert.equal(Object.hasOwn(context, 'slots'), false)
  assert.equal(seen.slots, 3)
})

test('late dependencies resolve at call time and name a missing provider', () => {
  const context = createCompositionContext()
  const { publish } = late(context, 'publish')
  assert.throws(() => publish(), /'publish' was called before a stage provided it/)
  provide(context, { publish: (value) => `published ${value}` }, 'later')
  assert.equal(publish('state'), 'published state')
})
