import { expect, it } from 'vitest'
import { taskBrowserAgentId } from './chatAgentTaskNav'

it('names the browser of a leased task, ephemeral or persistent', () => {
  const base = { task_id: 'cat_ac0aef645cd272af52df', status: 'RUNNING' }
  expect(taskBrowserAgentId({ ...base, type: 'ORCHESTRATOR_PLAN', lease_owner: 'desktop-1:translator-1' })).toBe('ephemeral-cat_ac0aef645cd272af52df')
  expect(taskBrowserAgentId({ ...base, type: 'RELEASE_NOTES', lease_owner: 'desktop-1:translator-2' })).toBe('ephemeral-cat_ac0aef645cd272af52df')
  expect(taskBrowserAgentId({ ...base, type: 'TRANSLATE_MARKDOWN', lease_owner: 'desktop-1:translator-3' })).toBe('translator-cat_ac0aef645cd272af52df')
  expect(taskBrowserAgentId({ ...base, type: 'ORCHESTRATOR_EXECUTE', lease_owner: 'desktop-1:worker-2' })).toBe('worker-2')
  expect(taskBrowserAgentId({ ...base, status: 'WAITING', type: 'ORCHESTRATOR_PLAN', lease_owner: '' })).toBeUndefined()
})
