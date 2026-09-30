import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('Supervisor ownership binds early helpers and defers later comment lookup', async () => {
  const source = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const ownershipStart = source.indexOf('const {\n  chatGPTSupervisorOwnsExpectedResponse,')
  const ownershipEnd = source.indexOf('\n})', ownershipStart)
  const urlsStart = source.indexOf('const {\n  conversationID: chatGPTConversationID,')
  const urlsCall = '} = createChatGPTConversationURLs(requireTrustedChatGPTURL)'
  const urlsEnd = source.indexOf(urlsCall, urlsStart) + urlsCall.length
  assert.ok(ownershipStart >= 0 && ownershipEnd > ownershipStart)
  assert.ok(urlsStart >= 0 && urlsEnd > urlsStart + urlsCall.length)

  let options
  const context = {
    createSupervisorOwnership: (value) => { options = value; return {} },
    createChatGPTConversationURLs: () => ({
      conversationID: () => 'id',
      canonicalURL: (value) => `canonical:${value}`,
      sameConversation: (left, right) => left === right,
    }),
    chatgptViews: new Map(), chatgptTransportModes: new Map(),
    expectedChatGPTBundles: new Map(), pendingChatGPTBundleDeliveries: new Map(),
    chatGPTTransportTails: new Map(),
    chatSupervisorStates: new Map(), preparedChatGPTDrafts: new Map(),
    retryableChatGPTPrompts: new Map(), RETRYABLE_PROMPT_TTL_MS: 100,
    sanitizeOptionalChatCacheKey: (value) => value,
    chatAgentConversationID: () => 'id',
    requireTrustedChatGPTURL: (value) => value,
  }
  const ownership = source.slice(ownershipStart, ownershipEnd + 3)
  const urls = source.slice(urlsStart, urlsEnd)
  const declarations = urlsStart < ownershipStart ? `${urls}\n${ownership}` : `${ownership}\n${urls}`
  runInNewContext(`${declarations}\nconst hasPendingChatGPTComments = () => false`, context)
  assert.equal(options.canonicalChatGPTConversationURL('one'), 'canonical:one')
  assert.equal(options.sameConversationURL('one', 'one'), true)
  assert.equal(options.hasPendingChatGPTComments('one'), false)
})
