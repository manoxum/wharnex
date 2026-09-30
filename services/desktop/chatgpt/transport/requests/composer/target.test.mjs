import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTComposerTarget } from './target.mjs'

function fixture({ externalAuthProvider = '', health = { composerReady: true } } = {}) {
  const events = []
  let reloaded = false
  const wc = {
    getURL: () => 'https://chatgpt.com/c/owned',
    reload: () => { events.push('reload'); reloaded = true },
  }
  const entry = { affinity: { boundURL: '', phase: '' }, humanAction: {}, externalAuthProvider }
  const { targetChatGPTComposer } = createChatGPTComposerTarget({
    sanitizeChatCacheKey: (key) => key,
    ensureChatGPTView: () => ({ entry }),
    requireOwnedChatGPTEntry: () => ({ wc }),
    ensureChatGPTLayoutViewport: () => events.push('viewport'),
    requireTrustedChatGPTURL: (url) => url,
    canonicalChatGPTConversationURL: (url) => url,
    syncChatGPTAffinityURL: () => events.push('sync'),
    sameConversationURL: (a, b) => a === b,
    loadOwnedChatGPTURL: async () => events.push('navigate'),
    proposeCurrentChatGPTAffinity: () => events.push('propose'),
    waitForChatGPTSurfaceReady: async () => events.push('ready'),
    executeChatGPTDOMScript: async (_, __, stage) => stage === 'composer-ready' ? reloaded : health,
    chatGPTHumanActionScript: () => 'health-script',
    noteChatGPTRateLimitGate: () => false,
    setChatGPTHumanAction: (_, kind) => events.push(`human:${kind}`),
    clearChatGPTHumanAction: () => events.push('clear-human'),
    chatGPTHumanActionMessage: (kind) => `human:${kind}`,
    chatGPTComposerReadyScript: () => 'ready-script',
    touchChatGPTEntry: () => events.push('touch'),
    wait: async () => {},
  })
  return { targetChatGPTComposer, events, entry, wc }
}

test('composer target grants hidden viewport and reloads once before a successful send', async () => {
  const { targetChatGPTComposer, events, entry, wc } = fixture()
  const target = await targetChatGPTComposer('chat', '', false, entry)
  assert.equal(target.entry, entry)
  assert.equal(target.wc, wc)
  assert.equal(events.filter((event) => event === 'reload').length, 1)
  assert.deepEqual(events.slice(0, 2), ['viewport', 'ready'])
  assert.equal(events.at(-1), 'touch')
})

test('external authentication and human challenge block composer interaction', async () => {
  const external = fixture({ externalAuthProvider: 'browser' })
  await assert.rejects(external.targetChatGPTComposer('chat'), /autenticação externa/)
  assert.deepEqual(external.events, ['viewport'])

  const challenged = fixture({ health: { required: true, kind: 'verification' } })
  await assert.rejects(challenged.targetChatGPTComposer('chat'), /human:verification/)
  assert.deepEqual(challenged.events, ['viewport', 'ready', 'human:verification'])
})
