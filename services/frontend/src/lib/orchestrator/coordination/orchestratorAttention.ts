import type { AttentionRecord, OrchestratorTaskConclusion } from '../../../types'
import type { AttentionItem } from '../../attention/center/attentionCenter'
import { mergeAttentionItems } from '../../attention/center/attentionItems'

export type WorkspaceAttentionPayload = {
  records?: AttentionRecord[] | null
  orchestrator_conclusions?: OrchestratorTaskConclusion[] | null
}

export function normalizeWorkspaceAttentionPayload(payload: WorkspaceAttentionPayload) {
  return {
    records: Array.isArray(payload?.records) ? payload.records : [],
    orchestratorConclusions: Array.isArray(payload?.orchestrator_conclusions) ? payload.orchestrator_conclusions : [],
  }
}

export function orchestratorConclusionAttentionItems(conclusions: OrchestratorTaskConclusion[]): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const conclusion of conclusions) {
    const runId = conclusion.run_id?.trim()
    const taskId = conclusion.task_id?.trim()
    const occurredAt = conclusion.completed_at?.trim()
    if (!runId || !taskId || !occurredAt || Number.isNaN(Date.parse(occurredAt))) continue
    const taskTitle = conclusion.title?.trim() || taskId
    items.push({
      id: `orchestrator:task-completed:${runId}`,
      chatId: `orchestrator:${taskId}`,
      chatTitle: 'Orchestrator',
      title: `Task concluída: ${taskTitle}`,
      detail: `A task ${taskTitle} terminou com sucesso.`,
      tone: 'success',
      kind: 'task-completed',
      occurredAt,
      orchestratorTaskId: taskId,
      orchestratorRunId: runId,
    })
  }
  return mergeAttentionItems(items)
}

export function shouldPublishNativeAttentionAfterBaseline(item: AttentionItem, baselineMs: number) {
  if (item.kind !== 'task-completed') return true
  const occurredAt = Date.parse(item.occurredAt || '')
  return Number.isFinite(occurredAt) && occurredAt >= baselineMs
}
