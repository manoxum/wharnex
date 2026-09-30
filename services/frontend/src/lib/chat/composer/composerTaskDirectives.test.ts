import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorTask, OrchestratorTaskStatus } from '../../../types'
import { api } from '../../transport/http/api'
import { canonicalTaskDirective, completedTaskReference, loadComposerTaskDirectivePage, taskDirectiveCandidate } from './composerTaskDirectives'

function task(id: string, status: OrchestratorTaskStatus, wasCompleted = status === 'COMPLETE'): OrchestratorTask {
  return {
    id, project_path: '/workspace/demo', title: 'Título repetido', description: `Descrição ${id}`, status, condition: 'none', priority: 'normal', parallelizable: false,
    was_completed: wasCompleted, created_at: '2026-09-28T00:00:00Z', updated_at: `2026-09-28T00:00:0${id.endsWith('2') ? '2' : '1'}Z`,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('@task composer contract', () => {
  it('keeps canonical markers strict and labels duplicate titles with task IDs', () => {
    expect(canonicalTaskDirective('otk_123.done')).toBe('@{[task]otk_123.done}')
    expect(() => canonicalTaskDirective('../otk')).toThrow()
    const candidate = taskDirectiveCandidate(task('otk_1', 'COMPLETE'))
    expect(candidate).toMatchObject({ label: 'Título repetido', detail: 'otk_1 · Concluída' })
  })

  it('accepts COMPLETE and only ARCHIVED tasks with durable completion evidence', () => {
    expect(completedTaskReference(task('complete', 'COMPLETE'))).toBe(true)
    expect(completedTaskReference(task('archived-done', 'ARCHIVED', true))).toBe(true)
    expect(completedTaskReference(task('archived-never-done', 'ARCHIVED', false))).toBe(false)
    expect(completedTaskReference(task('incomplete', 'REVIEW'))).toBe(false)
  })

  it('loads bounded terminal pages, filters archived-never-completed tasks and advances cursors', async () => {
    const complete = task('otk_1', 'COMPLETE')
    const archived = task('otk_2', 'ARCHIVED', true)
    const rejected = task('otk_3', 'ARCHIVED', false)
    const request = vi.spyOn(api, 'orchestratorTasks')
      .mockResolvedValueOnce({ tasks: [complete], total: 2, has_more: true, next_cursor: 'complete-next' })
      .mockResolvedValueOnce({ tasks: [archived, rejected], total: 2, has_more: false })
      .mockResolvedValueOnce({ tasks: [], total: 2, has_more: false })

    const first = await loadComposerTaskDirectivePage('ses_1', 'Título')
    expect(request).toHaveBeenNthCalledWith(1, 'ses_1', { status: 'COMPLETE', q: 'Título', limit: 8, cursor: undefined })
    expect(request).toHaveBeenNthCalledWith(2, 'ses_1', { status: 'ARCHIVED', q: 'Título', limit: 8, cursor: undefined })
    expect(first.tasks.map((item) => item.id)).toEqual(['otk_2', 'otk_1'])
    expect(first.hasMore).toBe(true)

    const second = await loadComposerTaskDirectivePage('ses_1', 'Título', first.cursors)
    expect(request).toHaveBeenNthCalledWith(3, 'ses_1', { status: 'COMPLETE', q: 'Título', limit: 8, cursor: 'complete-next' })
    expect(request).toHaveBeenCalledTimes(3)
    expect(second.hasMore).toBe(false)
  })

  it('returns no candidates for nonexistent or incomplete-only result sets', async () => {
    vi.spyOn(api, 'orchestratorTasks')
      .mockResolvedValueOnce({ tasks: [], total: 0, has_more: false })
      .mockResolvedValueOnce({ tasks: [task('otk_archived', 'ARCHIVED', false)], total: 1, has_more: false })
    const page = await loadComposerTaskDirectivePage('ses_1', 'missing')
    expect(page.candidates).toEqual([])
  })
})
