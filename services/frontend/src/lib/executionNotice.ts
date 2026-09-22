import type { ChatItem, HarnessEvent } from '../types'

export function executionStartedNotice(event: Pick<HarnessEvent, 'id' | 'data'> & Partial<Pick<HarnessEvent, 'timestamp'>>): ChatItem {
  const planId = String(event.data.plan_id || '').trim()
  const directHost = event.data.execution_mode === 'unprotected' || event.data.execution_mode === 'full' || event.data.target === 'host'
  return {
    id: `execution-started:${event.id}`,
    role: 'harness',
    source: 'wharness',
    presentation: 'notice',
    createdAt: event.timestamp || new Date().toISOString(),
    text: directHost ? 'Execução iniciada diretamente no host.' : 'Execução iniciada na sandbox protegida.',
    meta: `Execução iniciada${planId ? ` · ${planId}` : ''}`,
  }
}
