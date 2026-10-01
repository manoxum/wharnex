import assert from 'node:assert/strict'
import test from 'node:test'
import { projectAccentColor, sanitizeTrayProjectState, summarizeTrayWorkers, trayStatusLabel } from './desktop-tray-model.mjs'

test('project tray accents are deterministic and differ across paths', () => {
  assert.equal(projectAccentColor('/work/alpha'), projectAccentColor('/work/alpha'))
  assert.notEqual(projectAccentColor('/work/alpha'), projectAccentColor('/work/beta'))
})

test('project tray accents are hex colors the icon rasterizer can fill with', () => {
  for (const projectPath of ['/work/alpha', '/work/beta', '/work/gamma', '', '/a']) {
    assert.match(projectAccentColor(projectPath), /^#[0-9a-f]{6}$/)
  }
})

test('project tray state is bounded and exposes execution controls', () => {
  const state = sanitizeTrayProjectState('/work/alpha', { attentionTotal: 3, actionable: 2, canControlExecution: true, planControl: 'paused' })
  assert.deepEqual({ projectPath: state.projectPath, attentionTotal: state.attentionTotal, actionable: state.actionable, canControlExecution: state.canControlExecution, planControl: state.planControl }, { projectPath: '/work/alpha', attentionTotal: 3, actionable: 2, canControlExecution: true, planControl: 'paused' })
  assert.equal(trayStatusLabel(state), '2 ações pendentes')
})

test('worker summary reports busy, error and suspension state', () => {
  const summary = summarizeTrayWorkers({ worker_pause: { paused: true }, agents: [
    { id: 'supervisor-1', role: 'supervisor', status: 'running' },
    { id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'running', occupied: true },
    { id: 'worker-2', label: 'Worker 2', role: 'worker', status: 'error', error: 'boom' },
  ] })
  assert.deepEqual({ total: summary.total, busy: summary.busy, errors: summary.errors, paused: summary.paused }, { total: 2, busy: 1, errors: 1, paused: true })
})
