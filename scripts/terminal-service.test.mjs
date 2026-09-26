import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'terminal-service.sh')

// A checkout whose terminal binary is a tiny Node daemon: it listens on the
// socket it is given, or (mode "die") exits at once like a daemon that cannot
// start.
function fakeCheckout(mode = 'serve') {
  const root = mkdtempSync(path.join(tmpdir(), 'whx-terminal-'))
  const binary = path.join(root, 'dist', 'bin', 'wharnex-host-pty')
  mkdirSync(path.dirname(binary), { recursive: true })
  writeFileSync(binary, mode === 'die'
    ? '#!/bin/sh\necho "fatal: cannot open pty" >&2\nexit 1\n'
    : `#!/usr/bin/env node\nrequire('node:net').createServer((s) => s.end()).listen(process.argv[3])\n`)
  chmodSync(binary, 0o755)
  return { root, binary, socket: path.join(root, '.harness', 'bridge', 'terminal.sock'), pidFile: path.join(root, '.harness', 'state', 'terminald.pid') }
}

function ensure(root, setup = '') {
  try {
    return { code: 0, output: execFileSync(setup ? 'bash' : 'sh', ['-c', `. "${script}"; ROOT="${root}"; ${setup} ensure_terminal_service`], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    return { code: error.status, output: `${error.stdout}${error.stderr}` }
  }
}

test('launcher startup survives an inherited descriptor above nine', () => {
  const checkout = fakeCheckout()
  const result = ensure(checkout.root, `exec 10>"${checkout.root}/inherited.log";`)
  try {
    assert.equal(result.code, 0, result.output)
    assert.ok(existsSync(checkout.socket))
  } finally { stop(checkout.root) }
})

function stop(root) {
  execFileSync('sh', ['-c', `. "${script}"; ROOT="${root}"; stop_terminal_service`])
}

test('a stale pid file with no live daemon does not stop a start', () => {
  const checkout = fakeCheckout()
  mkdirSync(path.dirname(checkout.pidFile), { recursive: true })
  writeFileSync(checkout.pidFile, '999999\n')
  try {
    const result = ensure(checkout.root)
    assert.equal(result.code, 0, result.output)
    assert.ok(existsSync(checkout.socket))
  } finally { stop(checkout.root) }
})

test('a live daemon that no longer answers is retired and replaced', () => {
  const checkout = fakeCheckout()
  mkdirSync(path.dirname(checkout.pidFile), { recursive: true })
  // Alive, running the terminal binary, but serving no socket at all.
  const mute = spawn('bash', ['-c', `exec -a "${checkout.binary}" sleep 60`], { stdio: 'ignore' })
  writeFileSync(checkout.pidFile, `${mute.pid}\n`)
  try {
    const result = ensure(checkout.root)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /Retiring unresponsive host terminal service/)
    assert.notEqual(readFileSync(checkout.pidFile, 'utf8').trim(), String(mute.pid))
  } finally { mute.kill('SIGKILL'); stop(checkout.root) }
})

test('a daemon that dies at start fails fast, retries once and shows its log', () => {
  const checkout = fakeCheckout('die')
  const started = Date.now()
  const result = ensure(checkout.root)
  assert.notEqual(result.code, 0)
  assert.match(result.output, /Retrying the host terminal service once/)
  assert.match(result.output, /fatal: cannot open pty/)
  assert.ok(Date.now() - started < 10_000, 'a dead daemon must not be waited on for the full readiness window')
})
