import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { startDesktopRuntime } from './index.mjs'

test('startup configures the browser before windows and starts durable schedulers in order', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'wharnex-startup-test-'))
  const events = []
  const host = { isDestroyed: () => false }
  const desktopWindows = new Map([['primary', { window: host }]])
  let deferredWorkerStart
  let assignedWorker
  const scheduler = (name) => ({
    start: () => events.push(`${name}:start`),
    stop: () => events.push(`${name}:stop`),
  })
  try {
    await startDesktopRuntime({
      app: { getPath: () => temp },
      applyPendingBrowserSessionImport: async () => { events.push('import') },
      logger: { error: () => events.push('error') },
      configureChatGPTSession: async (options) => { assert.equal(options.partition, 'chat'); events.push('session') },
      chatGPTSessionOptions: { partition: 'chat' },
      loadChatAgentPolicies: () => { events.push('load-policies'); return { enabled: true } },
      setChatAgentPolicies: (value) => { assert.equal(value.enabled, true); events.push('set-policies') },
      registerIPC: () => events.push('ipc'),
      ensureDesktopTray: () => events.push('tray'),
      beginDownloadPoller: () => events.push('poller'),
      restoreDesktopWindows: () => events.push('windows'),
      restoreWindowsOptions: {},
      refreshDesktopTray: () => events.push('refresh-tray'),
      desktopWindows,
      worker: {
        create: ({ workerHost }) => { assert.equal(workerHost.window, host); events.push('worker:create'); return scheduler('worker') },
        assign: (value) => { assignedWorker = value; events.push('worker:assign') },
        options: {}, prime: async () => { events.push('worker:prime') },
        isQuitting: () => false, startupDelayMs: 100,
      },
      translator: {
        create: () => { events.push('translator:create'); return scheduler('translator') },
        assign: () => events.push('translator:assign'), options: {},
      },
      supervisor: {
        create: () => { events.push('supervisor:create'); return scheduler('supervisor') },
        assign: () => events.push('supervisor:assign'), options: {},
      },
      refreshChatAgentRuntimeState: async () => { events.push('runtime:refresh'); return 'state' },
      publishChatAgentRuntimeState: (state) => events.push(`runtime:publish:${state}`),
      scheduleWorkerStart: (callback, delay) => { assert.equal(delay, 100); deferredWorkerStart = callback },
    })
    assert.ok(assignedWorker)
    assert.deepEqual(events.slice(0, 17), [
      'import', 'session', 'load-policies', 'set-policies', 'ipc', 'tray', 'poller',
      'windows', 'refresh-tray', 'worker:create', 'worker:assign',
      'translator:create', 'translator:assign', 'translator:start',
      'supervisor:create', 'supervisor:assign', 'supervisor:start',
    ])
    await deferredWorkerStart()
    assert.ok(events.indexOf('worker:prime') < events.indexOf('worker:start'))
    assert.ok(events.includes('runtime:publish:state'))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('worker startup checks quit both before and after the asynchronous prime', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'wharnex-startup-stop-test-'))
  let delayed
  let quitting = true
  const events = []
  const noOpScheduler = { start: () => events.push('start') }
  try {
    await startDesktopRuntime({
      app: { getPath: () => temp }, applyPendingBrowserSessionImport: async () => {},
      logger: console, configureChatGPTSession: async () => {}, chatGPTSessionOptions: {},
      loadChatAgentPolicies: () => ({}), setChatAgentPolicies: () => {},
      registerIPC: () => {}, ensureDesktopTray: () => {}, beginDownloadPoller: () => {},
      restoreDesktopWindows: () => {}, restoreWindowsOptions: {}, refreshDesktopTray: () => {},
      desktopWindows: new Map(),
      worker: { create: () => noOpScheduler, assign: () => {}, options: {},
        prime: async () => { events.push('prime'); quitting = true },
        isQuitting: () => quitting, startupDelayMs: 0 },
      translator: { create: () => noOpScheduler, assign: () => {}, options: {} },
      supervisor: { create: () => noOpScheduler, assign: () => {}, options: {} },
      refreshChatAgentRuntimeState: async () => ({}), publishChatAgentRuntimeState: () => {},
      scheduleWorkerStart: (callback) => { delayed = callback },
    })
    await delayed()
    assert.deepEqual(events, ['start', 'start'])
    quitting = false
    await delayed()
    assert.deepEqual(events, ['start', 'start', 'prime'])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
