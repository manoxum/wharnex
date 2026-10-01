import { expect, it } from 'vitest'
import { operationalState, stateLegend } from './browserMonitorModel'

const base: DesktopAgentRuntimeAgent = {
  id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'idle', draining: false,
  chat_id: '', error: '', browser: { available: true, web_contents_id: 1, url: '', title: '', loading: false },
}

it('maps runtime conditions to the same states shown in the legend', () => {
  const cases: [Partial<DesktopAgentRuntimeAgent>, string][] = [
    [{}, 'idle'],
    [{ chat_id: 'chat-1' }, 'chat-empty'],
    [{ suspended: true }, 'paused'],
    [{ draining: true }, 'draining'],
    [{ status: 'error', error: 'Falha' }, 'error'],
    [{ loop_active: false }, 'stopped'],
    [{ browser: { ...base.browser, loading: true } }, 'loading'],
    [{ occupied: true, pinned_task_id: 'task-1' }, 'waiting'],
    [{ activity: { phase: 'validating', since: '', task_id: 'task-1' }, task: { type: 'ORCHESTRATOR_PLAN', task_id: 'task-1' } as DesktopAgentRuntimeTask }, 'working'],
    [{ task: { type: 'ORCHESTRATOR_PLAN', task_id: 'task-1', status: 'RUNNING' } as DesktopAgentRuntimeTask }, 'writing'],
    [{ task: { type: 'ORCHESTRATOR_PLAN', task_id: 'task-1', status: 'WAITING' } as DesktopAgentRuntimeTask }, 'waiting'],
    [{ task: { type: 'AWAIT_RESPONSE', task_id: 'task-1' } as DesktopAgentRuntimeTask }, 'listening'],
  ]
  for (const [change, expected] of cases) {
    const key = operationalState({ ...base, ...change }).key
    expect(key).toBe(expected)
    expect(stateLegend.some((entry) => entry.key === key)).toBe(true)
  }
})
