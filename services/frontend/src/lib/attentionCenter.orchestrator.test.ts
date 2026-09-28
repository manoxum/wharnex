import { describe, expect, it } from 'vitest'
import type { AttentionItem } from './attentionCenter'
import { mergeAttentionItems } from './attentionItems'
import { normalizeWorkspaceAttentionPayload, orchestratorConclusionAttentionItems, shouldPublishNativeAttentionAfterBaseline } from './orchestratorAttention'
import type { OrchestratorTaskConclusion } from '../types'

const conclusion = (status: OrchestratorTaskConclusion['status'] = 'REVIEW'): OrchestratorTaskConclusion => ({
  run_id: 'run-1',
  task_id: 'otk-task-1',
  title: 'Integrar conclusões no centro global',
  status,
  completed_at: '2026-09-28T15:20:00.000Z',
})

describe('Orchestrator attention projection', () => {
  it('uses the run as stable completion identity across task status changes', () => {
    const review = orchestratorConclusionAttentionItems([conclusion('REVIEW')])
    const archived = orchestratorConclusionAttentionItems([conclusion('ARCHIVED')])
    expect(review).toEqual([expect.objectContaining({
      id: 'orchestrator:task-completed:run-1',
      chatId: 'orchestrator:otk-task-1',
      chatTitle: 'Orchestrator',
      title: 'Task concluída: Integrar conclusões no centro global',
      tone: 'success',
      kind: 'task-completed',
      occurredAt: '2026-09-28T15:20:00.000Z',
      orchestratorTaskId: 'otk-task-1',
      orchestratorRunId: 'run-1',
    })])
    expect(mergeAttentionItems(review, archived)).toHaveLength(1)
  })

  it('deduplicates repeated runs and ignores malformed completion timestamps', () => {
    const duplicate = { ...conclusion('COMPLETE'), status: 'ARCHIVED' as const }
    const invalid = { ...conclusion(), run_id: 'run-invalid', completed_at: 'not-a-date' }
    expect(orchestratorConclusionAttentionItems([conclusion(), duplicate, invalid])).toHaveLength(1)
  })

  it('keeps the workspace attention endpoint compatible while conclusions roll out', () => {
    expect(normalizeWorkspaceAttentionPayload({ records: null })).toEqual({ records: [], orchestratorConclusions: [] })
    expect(normalizeWorkspaceAttentionPayload({ records: [], orchestrator_conclusions: [conclusion()] }).orchestratorConclusions).toHaveLength(1)
  })

  it('preserves ordinary chat and restart alerts when project-level conclusions are merged', () => {
    const chatCompletion: AttentionItem = { id: 'chat-1:task-completed:1', chatId: 'chat-1', chatTitle: 'Chat', title: 'Tarefa concluída', detail: 'ok', tone: 'success', kind: 'task-completed', occurredAt: '2026-09-28T15:21:00.000Z' }
    const restart: AttentionItem = { id: 'chat-2:restart-pending:1', chatId: 'chat-2', chatTitle: 'Auto-evolução', title: 'Auto-evolução concluída', detail: 'restart', tone: 'success', kind: 'restart-pending', occurredAt: '2026-09-28T15:22:00.000Z' }
    expect(mergeAttentionItems([chatCompletion], [restart], orchestratorConclusionAttentionItems([conclusion()])).map((item) => item.id)).toEqual(expect.arrayContaining([
      chatCompletion.id,
      restart.id,
      'orchestrator:task-completed:run-1',
    ]))
  })

  it('does not publish task completions that predate the native notification baseline', () => {
    const item = orchestratorConclusionAttentionItems([conclusion()])[0]
    expect(shouldPublishNativeAttentionAfterBaseline(item, Date.parse('2026-09-28T15:20:00.001Z'))).toBe(false)
    expect(shouldPublishNativeAttentionAfterBaseline(item, Date.parse('2026-09-28T15:20:00.000Z'))).toBe(true)
    expect(shouldPublishNativeAttentionAfterBaseline({ ...item, kind: 'restart-pending' }, Date.parse('2026-09-29T00:00:00.000Z'))).toBe(true)
  })
})
