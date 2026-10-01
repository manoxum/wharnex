import assert from 'node:assert/strict'
import test from 'node:test'
import { chatAgentMemorySnapshot } from './chat-agent-memory.mjs'

const MiB = 1024 * 1024

function agent(id, role, pid) {
  return { id, role, browser: { os_process_id: pid } }
}

function metric(pid, workingSetSize) {
  return { pid, memory: { workingSetSize } }
}

test('attributes renderer RSS per agent and keeps global totals additive', () => {
  const snapshot = chatAgentMemorySnapshot([
    agent('supervisor-1', 'supervisor', 101),
    agent('supervisor-2', 'supervisor', 0),
    agent('worker-1', 'worker', 201),
    agent('worker-2', 'worker', 201),
  ], [
    metric(1, 100 * 1024),
    metric(101, 256 * 1024),
    metric(201, 512 * 1024),
    metric(301, 50 * 1024),
  ])

  assert.equal(snapshot.by_agent['supervisor-1'].rss_bytes, 256 * MiB)
  assert.equal(snapshot.by_agent['worker-1'].rss_bytes, 256 * MiB)
  assert.equal(snapshot.by_agent['worker-2'].rss_bytes, 256 * MiB)
  assert.equal(snapshot.by_agent['worker-1'].shared_process, true)
  assert.equal(snapshot.by_agent['supervisor-2'].available, false)
  assert.equal(snapshot.totals.total_workers_bytes, 512 * MiB)
  assert.equal(snapshot.totals.total_supervisors_bytes, 256 * MiB)
  assert.equal(snapshot.totals.total_agents_bytes, 768 * MiB)
  assert.equal(snapshot.totals.desktop_bytes, 150 * MiB)
  assert.equal(snapshot.totals.total_bytes, 918 * MiB)
  assert.equal(snapshot.totals.total_agents_bytes + snapshot.totals.desktop_bytes, snapshot.totals.total_bytes)
})

test('reports unavailable measurements without inventing RAM usage', () => {
  const snapshot = chatAgentMemorySnapshot([agent('worker-1', 'worker', 99)], [])
  assert.equal(snapshot.by_agent['worker-1'].available, false)
  assert.deepEqual(snapshot.totals, {
    available: false,
    total_workers_bytes: 0,
    total_supervisors_bytes: 0,
    total_agents_bytes: 0,
    desktop_bytes: 0,
    total_bytes: 0,
  })
})
