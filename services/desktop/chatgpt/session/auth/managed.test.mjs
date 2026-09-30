import assert from 'node:assert/strict'
import test from 'node:test'
import { electronCookieDetails } from '../managed-browser-auth.mjs'
import { createManagedAuthentication } from './managed.mjs'

test('managed authentication starts from the fixed login URL and relays only to the private partition', async () => {
  const records = new Map()
  const imported = []
  const launches = []
  const navigation = []
  let resolveLaunch
  let notifyComplete
  const completed = new Promise((resolve) => { notifyComplete = resolve })
  const entry = {
    ownerKey: 'chat-1',
    authMode: 'embedded',
    view: {
      setVisible: () => undefined,
      webContents: { isDestroyed: () => false, getURL: () => 'https://chatgpt.com/auth/login' },
    },
  }
  const auth = createManagedAuthentication({
    chatGPTAuthBrowsers: records,
    chatGPTKeyForEntry: (candidate) => candidate.ownerKey,
    managedAuthProfilePath: () => '/private/managed-profile',
    closeManagedBrowserAuth: async () => undefined,
    launchManagedBrowserAuth: (options) => {
      launches.push(options)
      return new Promise((resolve) => { resolveLaunch = resolve })
    },
    electronCookieDetails,
    session: {
      fromPartition: (partition) => {
        assert.equal(partition, 'persist:wharness-chatgpt')
        return {
          cookies: { set: async (details) => imported.push(details) },
          flushStorageData: async () => undefined,
        }
      },
    },
    partition: 'persist:wharness-chatgpt',
    loginURL: 'https://chatgpt.com/auth/login',
    homeURL: 'https://chatgpt.com/',
    isTrustedChatGPTOrigin: (url) => url.startsWith('https://chatgpt.com/'),
    isChatGPTAuthURL: (url) => url.includes('/auth/'),
    loadOwnedChatGPTURL: async (_key, _entry, url, reason) => navigation.push([url, reason]),
    windowStateForEntry: () => ({ activeChatGPTKey: 'chat-1' }),
    chatGPTSurfaceShouldBeVisible: () => true,
    publishChatGPTState: () => undefined,
    publishAuthComplete: (_key, mode) => { notifyComplete(mode) },
    publishAuthError: (_key, _provider, message) => assert.fail(message),
    publishExternalAuth: () => undefined,
    sanitizeDiagnosticURL: (url) => url,
  })
  assert.deepEqual(auth.startExternalAuthentication(entry), { ok: true, cacheKey: 'chat-1', reused: false })
  assert.equal(launches[0].profileDir, '/private/managed-profile')
  assert.equal(launches[0].loginURL, 'https://chatgpt.com/auth/login')
  assert.deepEqual(auth.startExternalAuthentication(entry), { ok: true, cacheKey: 'chat-1', reused: true })
  assert.equal(launches.length, 1)
  resolveLaunch({
    port: 1, child: {},
    callbackURL: 'https://chatgpt.com/',
    cookies: [{ domain: '.chatgpt.com', name: 'session', value: 'private' }],
  })
  assert.equal(await completed, 'external')
  assert.deepEqual(navigation, [['https://chatgpt.com/', 'external-auth-complete']])
  assert.equal(imported.length, 1)
  assert.equal(records.size, 0)
})
