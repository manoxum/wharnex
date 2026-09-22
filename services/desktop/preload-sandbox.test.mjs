import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Electron replaces `require` inside a sandboxed preload with a polyfill that
// resolves only these specifiers. Anything else throws, which aborts the whole
// preload and silently leaves the trusted renderer without `wharnessDesktop`.
const SANDBOX_SAFE_MODULES = new Set(['electron', 'events', 'timers', 'url'])

test('the privileged preload can still be loaded by a sandboxed renderer', async () => {
  const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8')
  const specifiers = [...preload.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(([, specifier]) => specifier)

  assert.ok(specifiers.length > 0, 'preload should still require electron')
  for (const specifier of specifiers) {
    assert.ok(
      SANDBOX_SAFE_MODULES.has(specifier),
      `a sandboxed preload cannot require ${specifier}; keep preload.cjs self-contained`,
    )
  }
  assert.doesNotMatch(preload, /^\s*import\s/m, 'preload.cjs is CommonJS and must not use ESM imports')
})

test('the window receiving that preload is the sandboxed one, which is what bounds its require', async () => {
  const main = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

  assert.match(main, /sandbox: true/)
  assert.match(main, /securePreferences\(\{ preload: path\.join\(here, 'preload\.cjs'\) \}\)/)
})
