import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { HarnessEvent, Session } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { useExecutionHistory } from './useExecutionHistory'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const session: Session = { id: 'ses', project_path: '/workspace/app', state: 'workflow_pending', execution_mode: 'protected', automation_mode: 'auto', created_at: '', context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/app', sha256: 'a', files: [], excluded: [], text_truncated: false } }, request_lineages: { 'req-first': { request_id: 'req-first', root_request_id: 'req-root', kind: 'evidence', created_at: '' } } }
const event = (id: string): HarnessEvent => ({ id, session_id: 'ses', type: 'execution.recorded', timestamp: '2026-10-09T01:00:00Z', data: { execution: { plan_id: id, success: true, commands: [{ argv: ['probe'], stdout: id }] } } })

it('refreshes durable results for a new workflow round within the same Main Request', async () => {
  const history = vi.spyOn(api, 'eventHistory').mockResolvedValueOnce({ events: [event('first')], total: 1, truncated: false }).mockResolvedValueOnce({ events: [event('first'), event('second')], total: 2, truncated: false })
  const view = renderHook(({ current }) => useExecutionHistory(current, 'terminal'), { initialProps: { current: session } })
  await waitFor(() => expect(view.result.current.events).toHaveLength(1))
  const continuation: Session = { ...session, plan: undefined, last_execution: undefined, request_lineages: { ...session.request_lineages, 'req-second': { request_id: 'req-second', root_request_id: 'req-root', kind: 'evidence', created_at: '' } } }
  view.rerender({ current: continuation })
  await waitFor(() => expect(view.result.current.events).toHaveLength(2))
  expect(history).toHaveBeenCalledTimes(2)
  expect(history).toHaveBeenLastCalledWith('ses', true)
})

it('hides outgoing session history while the next chat history is still loading', async () => {
  vi.spyOn(api, 'eventHistory').mockResolvedValueOnce({ events: [event('first')], total: 1, truncated: false }).mockImplementationOnce(() => new Promise(() => undefined))
  const view = renderHook(({ current }) => useExecutionHistory(current, 'terminal'), { initialProps: { current: session } })
  await waitFor(() => expect(view.result.current.events).toHaveLength(1))
  view.rerender({ current: { ...session, id: 'ses-other' } })
  expect(view.result.current.events).toEqual([])
})
