import { beforeEach, describe, expect, it } from 'vitest'
import type { AttentionItem } from './attentionCenter'
import { acknowledgeCompletedAttention, filterActiveAttentionItems, loadCompletedAttentionHistory } from './attentionHistory'

const completed: AttentionItem = {
  id: 'chat-1:task-completed:2026-09-23T11:00:00.000Z',
  chatId: 'chat-1',
  chatTitle: 'Principal',
  title: 'Tarefa concluída',
  detail: 'Execução e integração no host concluídas com sucesso.',
  tone: 'success',
  kind: 'task-completed',
  occurredAt: '2026-09-23T11:00:00.000Z',
}

describe('completed attention history', () => {
  beforeEach(() => localStorage.clear())

  it('moves a clicked completed task out of active alerts and keeps it in project history', () => {
    const history = acknowledgeCompletedAttention('/project/a', completed, [])
    expect(filterActiveAttentionItems([completed], history)).toEqual([])
    expect(loadCompletedAttentionHistory('/project/a')).toEqual([completed])
  })

  it('keeps an acknowledged Orchestrator run hidden after task status transitions', () => {
    const orchestrator: AttentionItem = {
      id: 'orchestrator:task-completed:run-1',
      chatId: 'orchestrator:otk-task-1',
      chatTitle: 'Orchestrator',
      title: 'Task concluída: Integrar conclusões no centro global',
      detail: 'A task Integrar conclusões no centro global terminou com sucesso.',
      tone: 'success',
      kind: 'task-completed',
      occurredAt: '2026-09-28T15:20:00.000Z',
      orchestratorTaskId: 'otk-task-1',
      orchestratorRunId: 'run-1',
    }
    const history = acknowledgeCompletedAttention('/project/a', orchestrator, [])
    const archivedProjection = { ...orchestrator }
    expect(filterActiveAttentionItems([archivedProjection], history)).toEqual([])
    expect(loadCompletedAttentionHistory('/project/a')).toEqual([orchestrator])
  })

  it('does not hide a newer completion or non-completion attention', () => {
    const history = acknowledgeCompletedAttention('/project/a', completed, [])
    const newer = { ...completed, id: 'chat-1:task-completed:2026-09-23T11:10:00.000Z', occurredAt: '2026-09-23T11:10:00.000Z' }
    const warning: AttentionItem = { id: 'chat-1:approval-required', chatId: 'chat-1', chatTitle: 'Principal', title: 'Aprovação necessária', detail: 'Plano pronto.', tone: 'warning', target: 'plan' }
    expect(filterActiveAttentionItems([completed, newer, warning], history)).toEqual([newer, warning])
  })
})
