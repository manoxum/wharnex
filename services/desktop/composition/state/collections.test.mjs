import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopCollections } from './index.mjs'

test('desktop collections are isolated per process composition', () => {
  let registries = 0
  class Registry {
    constructor() { registries += 1 }
  }
  const first = createDesktopCollections(Registry)
  const second = createDesktopCollections(Registry)
  first.chatgptViews.set('chat', {})
  first.expectedChatGPTBundles.set('chat', { requestId: 'request' })
  first.desktopWindows.set('window', {})
  first.chatSupervisorStates.set(1, {})

  assert.equal(second.chatgptViews.size, 0)
  assert.equal(second.expectedChatGPTBundles.size, 0)
  assert.equal(second.desktopWindows.size, 0)
  assert.equal(second.chatSupervisorStates.size, 0)
  assert.equal(registries, 2)
  assert.notEqual(first.projectWindowRegistry, second.projectWindowRegistry)
})
