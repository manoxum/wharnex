import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createOwnedBrowserShell, ownedLinkProfileDirectory, requireBrowserUpLink } from './owned-shell.mjs'

test('HTTP links launch a dedicated browser process using the private profile', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wharnex-owned-browser-'))
  const launches = []
  let killed = false
  const browser = createOwnedBrowserShell({
    app: { getPath: () => root }, nativeShell: { openPath: async () => '' },
    sessionId: 'test-session',
    requireUpLink: () => {}, executable: () => '/bin/chromium',
    spawn: (command, args, options) => {
      launches.push({ command, args, options })
      const child = new EventEmitter()
      child.kill = () => { killed = true }
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
  })
  try {
    await browser.openExternal('https://chatgpt.com/c/owned')
    assert.equal(launches.length, 1)
    assert.equal(launches[0].command, '/bin/chromium')
    assert.deepEqual(launches[0].args, [
      `--user-data-dir=${path.join(ownedLinkProfileDirectory(root), 'test-session')}`,
      '--no-first-run', '--no-default-browser-check', '--new-window',
      'https://chatgpt.com/c/owned',
    ])
    assert.ok(existsSync(path.join(ownedLinkProfileDirectory(root), 'test-session')))
    browser.closeAll()
    assert.equal(killed, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a browser never opens in the host network namespace', async () => {
  assert.throws(() => requireBrowserUpLink('linux', () => 'net:[1]'), /fora de up-whx-link/)
  assert.doesNotThrow(() => requireBrowserUpLink('linux', (name) => name.endsWith('/self/ns/net') ? 'net:[2]' : 'net:[1]', 42))
  const browser = createOwnedBrowserShell({
    app: { getPath: () => '/tmp/owned-test' }, nativeShell: { openPath: async () => '' },
    requireUpLink: () => { throw new Error('host network') },
    spawn: () => assert.fail('must reject before spawning'),
  })
  await assert.rejects(browser.openExternal('https://chatgpt.com/'), /host network/)
  await assert.rejects(browser.openExternal('file:///etc/passwd'), /URL externa não permitida/)
})
