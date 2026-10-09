import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const bridgeURL = new URL('./host-git-bridge.mjs', import.meta.url).href

function launchBridge(t, home) {
  const root = mkdtempSync(path.join(tmpdir(), 'wharnex-host-git-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'dist/bin'), { recursive: true })
  writeFileSync(path.join(root, 'dist/bin/wharnex-host-pty'), '')
  const env = { ...process.env }
  if (home === undefined) delete env.HOME
  else env.HOME = home
  // Exercise the launcher in a separate process: the test runner's HOME and
  // credential configuration must stay untouched. Git uses only a fake helper.
  const source = `
    import { spawnSync } from 'node:child_process'
    import { startHostGitBridge } from ${JSON.stringify(bridgeURL)}
    startHostGitBridge(process.argv[1], (label, binary, args, cwd, overrides) => {
      const helper = '!f() { if test -n "$HOME"; then printf "username=fixture\\npassword=fixture-password\\n"; fi; }; f'
      const result = spawnSync('git', ['-c', 'credential.helper=', '-c', 'credential.helper=' + helper, 'credential', 'fill'], {
        cwd, encoding: 'utf8', input: 'protocol=https\\nhost=github.com\\n\\n',
        env: { ...process.env, ...overrides, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
      })
      process.stdout.write(JSON.stringify({ home: overrides.HOME ?? process.env.HOME, status: result.status, output: result.stdout, error: result.stderr }))
      return {}
    })
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, root], { env, encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout)
}

test('a launcher without HOME still lets host Git resolve credentials noninteractively', (t) => {
  const result = launchBridge(t)
  assert.equal(result.status, 0, result.error)
  assert.equal(result.home, userInfo().homedir)
  assert.match(result.output, /username=fixture\npassword=fixture-password/)
})

test('host Git preserves an explicitly configured HOME', (t) => {
  const result = launchBridge(t, '/fixture/explicit-home')
  assert.equal(result.status, 0, result.error)
  assert.equal(result.home, '/fixture/explicit-home')
})
