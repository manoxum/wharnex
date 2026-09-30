import test from 'node:test'
import assert from 'node:assert/strict'
import { configureChatGPTSession } from './session-setup.mjs'

function sessionHarness() {
  const observed = { cacheClears: 0, markerWrites: 0, uploads: 0, submissions: 0 }
  const chatSession = {
    setUserAgent: (ua, languages) => { observed.userAgent = [ua, languages] },
    webRequest: {
      onBeforeRequest: (_filter, callback) => { observed.before = callback },
      onErrorOccurred: (_filter, callback) => { observed.error = callback },
      onCompleted: (_filter, callback) => { observed.completed = callback },
    },
    setPermissionRequestHandler: (callback) => { observed.permissionRequest = callback },
    setPermissionCheckHandler: (callback) => { observed.permissionCheck = callback },
    clearCache: async () => { observed.cacheClears += 1 },
  }
  return {
    observed,
    inputs: {
      electronSession: {
        fromPartition: () => chatSession,
        defaultSession: { availableSpellCheckerLanguages: ['pt-PT', 'en-US'], setSpellCheckerLanguages: (languages) => { observed.spellcheck = languages } },
      },
      partition: 'persist:wharnex-test', userAgent: 'Chrome/152', acceptLanguages: 'pt-PT', chromiumVersion: '152',
      uploads: { onBeforeRequest: () => { observed.uploads += 1 }, onErrorOccurred: () => {}, onCompleted: () => {} },
      submissions: { onBeforeRequest: () => { observed.submissions += 1 } },
      cacheMarker: { current: () => false, write: () => { observed.markerWrites += 1 } },
      registerChatGPTPlanDownloads: () => { observed.downloadsRegistered = true },
      noteChatGPTNetworkActivity: () => {}, noteChatGPTNetworkFailure: () => {}, noteChatGPTHTTPStatus: () => {},
    },
  }
}

test('ChatGPT session setup keeps remote permissions narrow and network callbacks installed', async () => {
  const { observed, inputs } = sessionHarness()
  await configureChatGPTSession(inputs)
  assert.deepEqual(observed.userAgent, ['Chrome/152', 'pt-PT'])
  assert.deepEqual(observed.spellcheck, ['pt-PT', 'en-US'])
  assert.equal(observed.downloadsRegistered, true)
  assert.equal(observed.cacheClears, 1)
  assert.equal(observed.markerWrites, 1)
  let allowed
  observed.permissionRequest({ getURL: () => 'https://chatgpt.com/' }, 'clipboard-sanitized-write', (value) => { allowed = value }, {})
  assert.equal(allowed, true)
  observed.permissionRequest({ getURL: () => 'https://chatgpt.com/' }, 'clipboard-read', (value) => { allowed = value }, {})
  assert.equal(allowed, false)
  assert.equal(observed.permissionCheck(undefined, 'notifications', 'https://evil.example/', {}), false)
  observed.before({ url: 'https://chatgpt.com/', method: 'POST' }, () => {})
  assert.equal(observed.uploads, 1)
  assert.equal(observed.submissions, 1)
})

test('matching ChatGPT asset marker preserves the warm cache', async () => {
  const { observed, inputs } = sessionHarness()
  inputs.cacheMarker.current = () => true
  await configureChatGPTSession(inputs)
  assert.equal(observed.cacheClears, 0)
  assert.equal(observed.markerWrites, 0)
})
