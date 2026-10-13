import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { CodexRPC } from './rpc.mjs'

test('official app-server handshake is JSONL and all execution features are disabled', async () => {
  const frames = []; let launch
  const child = new EventEmitter()
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => child.emit('exit', 0) })
  child.stdin.on('data', (chunk) => {
    const frame = JSON.parse(chunk.toString()); frames.push(frame)
    if (frame.method === 'initialize') queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: frame.id, result: {} })}\n`))
  })
  const rpc = new CodexRPC({ command: () => ['codex-packaged'], spawnImpl: (...args) => { launch = args; return child } })
  await rpc.ready()
  assert.equal(frames[0].method, 'initialize')
  assert.equal(frames[0].params.clientInfo.name, 'wharnex')
  assert.equal(frames[1].method, 'initialized')
  assert.equal(launch[2].shell, false)
  assert.notEqual(launch[2].cwd, process.cwd())
  assert.equal(launch[2].env.ELECTRON_RUN_AS_NODE, '1')
  for (const value of ['features.shell_tool=false', 'features.unified_exec=false', 'features.hooks=false', 'features.apps=false', 'features.browser_use=false']) assert.ok(launch[1].includes(value))
  const waiting = rpc.call('model/list')
  rpc.stop()
  await assert.rejects(waiting, /interrompido/)
})
test('unexpected server requests are refused rather than approved', async () => {
  const replies = []
  const rpc = new CodexRPC()
  rpc.child = { stdin: { writable: true, write: (frame) => replies.push(JSON.parse(frame)) } }
  rpc.receive({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { command: 'sudo anything' } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(replies[0].error.code, -32601)
  assert.equal(replies[0].result, undefined)
})

test('shutdown sends EOF and waits for runtime termination before cleanup', async () => {
  const child = new EventEmitter()
  const stdin = new PassThrough()
  let killed = false
  Object.assign(child, { stdin, kill() { killed = true } })
  const rpc = new CodexRPC()
  rpc.child = child
  let stopped = false
  const closing = rpc.stop().then(() => { stopped = true })
  assert.equal(stdin.writableEnded, true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(stopped, false)
  child.emit('exit', 0)
  await closing
  assert.equal(stopped, true)
  assert.equal(killed, false)
})
