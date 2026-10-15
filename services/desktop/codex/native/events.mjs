import { nativePauseReason, normalizeNativeRecovery } from './recovery/state.mjs'
import { finalizeNativeChanges } from './finalization/index.mjs'

export function publicNativeThread(record) {
  normalizeNativeRecovery(record)
  return { projectPath: record.projectPath, chatId: record.chatId, threadId: record.threadId,
    title: record.title, requestId: record.requestId, model: record.model, native: true,
    status: record.status, error: record.error || '', archiveError: record.archiveError || '',
    messages: record.messages || [], activities: record.activities || [], pendingAsks: record.pendingAsks || [], tokenUsage: record.tokenUsage || null,
    startedAt: record.startedAt, completedAt: record.completedAt, accountId: record.accountId || 'default', permissionLevel: record.permissionLevel || 'full', selfEvolution: Boolean(record.selfEvolution), resumeAvailable: Boolean(record.resumeAvailable), pauseReason: record.pauseReason || '' }
}

export function createNativeEvents({ find, save, publish, journal, interactions, finalize = finalizeNativeChanges }) {
  return async function notification(method, params) {
    const record = find(params.threadId)
    if (!record || (params.turnId && record.turnId && params.turnId !== record.turnId)) return
    if (method === 'turn/completed' && record.turnId && params.turn?.id !== record.turnId) return
    if (!['submitting', 'running', 'waiting'].includes(record.status) && method !== 'thread/tokenUsage/updated' && !(record.status === 'attention' && method === 'turn/completed')) return
    // Only public summaries belong in the client. Never retain raw reasoning.
    if (method === 'item/reasoning/textDelta') return
    if (params.item?.type === 'reasoning') params = { ...params, item: { id: params.item.id, type: 'reasoning', summary: params.item.summary || [] } }
    await journal.append(record, method, params)
    if (method === 'error' && params.willRetry === false) {
      interactions.retire(record); record.status = 'attention'; record.resumeAvailable = true
      record.pauseReason = nativePauseReason(params.error)
      record.error = String(params.error?.message || 'O Codex interrompeu o pedido. Pode continuar manualmente.').slice(0, 2000)
    }
    if (method === 'item/reasoning/summaryTextDelta') {
      let item = (record.activities || []).find((entry) => entry.id === params.itemId)
      if (!item) { item = { id: params.itemId, type: 'reasoning', summary: [] }; record.activities = [...(record.activities || []), item].slice(-100) }
      const index = Math.min(100, Math.max(0, params.summaryIndex || 0))
      item.summary[index] = (String(item.summary[index] || '') + String(params.delta || '')).slice(0, 65536)
    }
    if (method === 'turn/plan/updated') record.activities = [...(record.activities || []).filter((item) => item.id !== 'native-plan'), { id: 'native-plan', type: 'plan', explanation: params.explanation || '', plan: params.plan || [] }]
    if (['item/autoApprovalReview/started', 'item/autoApprovalReview/completed'].includes(method)) record.activities = [...(record.activities || []).filter((item) => item.id !== params.reviewId), journal.sanitize({
      id: params.reviewId, type: 'approvalReview', status: params.review?.status, explanation: params.review?.rationale || '', riskLevel: params.review?.riskLevel || '',
    })].slice(-100)
    if (method === 'turn/started') record.turnId = params.turn?.id || record.turnId
    if (method === 'thread/tokenUsage/updated') record.tokenUsage = params.tokenUsage
    if (method === 'item/agentMessage/delta') {
      let message = record.messages.find((item) => item.id === params.itemId)
      if (!message) { message = { id: params.itemId, text: '', role: 'assistant' }; record.messages.push(message) }
      message.text = (message.text + String(params.delta || '')).slice(0, 65536)
    }
    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      record.messages = [...record.messages.filter((item) => item.id !== params.item.id), { id: params.item.id, role: 'assistant', text: String(params.item.text || '').slice(0, 65536) }]
    }
    if (['item/started', 'item/completed'].includes(method) && ['commandExecution', 'fileChange', 'mcpToolCall', 'reasoning'].includes(params.item?.type)) {
      if (params.item.type === 'fileChange') record.nativeChangedPaths = [...new Set([...(record.nativeChangedPaths || []), ...(params.item.changes || []).flatMap((change) => [change.path, change.kind?.move_path].filter(Boolean))])]
      record.activities = [...(record.activities || []).filter((item) => item.id !== params.item.id), journal.sanitize(params.item)].slice(-100)
    }
    if (method === 'item/commandExecution/outputDelta') {
      const item = record.activities?.find((entry) => entry.id === params.itemId)
      if (item) item.aggregatedOutput = String((item.aggregatedOutput || '') + (params.delta || '')).slice(-65536)
    }
    if (method === 'serverRequest/resolved') interactions.retire(record, params.requestId)
    record.messages = record.messages.slice(-80)
    if (method === 'turn/completed') {
      interactions.retire(record)
      record.completedAt = new Date().toISOString()
      record.status = params.turn?.status === 'completed' ? 'completed' : params.turn?.status === 'interrupted' ? 'idle' : 'attention'
      record.resumeAvailable = record.status !== 'completed'
      record.pauseReason = nativePauseReason(params.turn?.error, record.status === 'idle' ? 'interrupted' : record.status === 'attention' ? record.pauseReason || 'failure' : '')
      record.error = record.status === 'attention' ? String(params.turn?.error?.message || 'O Codex terminou com falha. Consulte a conversa.').slice(0, 2000) : ''
      if (record.status === 'completed' && Object.hasOwn(record, 'gitBaseline')) {
        record.status = 'running'
        let result
        try { result = await finalize(record) }
        catch { result = { id: 'native-finalization', type: 'nativeResult', status: 'failed', explanation: 'O fecho Git falhou. Reveja a identidade Git, VERSION e as alterações antes de fazer o commit manualmente.' } }
        result = journal.sanitize(result)
        record.activities = [...record.activities.filter((item) => item.id !== result.id), result]
        if (result.changes?.length) record.messages.push({ id: `${record.requestId}-git-result`, role: 'assistant', text: result.explanation, changes: result.changes, requestId: record.requestId, createdAt: record.completedAt })
        await journal.append(record, 'native/finalized', result)
        record.status = 'completed'
      }
      await save(record); publish(record)
      const snapshot = structuredClone(record)
      // Backend archival must never delay another native turn or question.
      void journal.settle(snapshot).then(() => {
        if (record.requestId === snapshot.requestId) { record.archiveError = ''; return save(record) }
      }).catch(async () => {
        if (record.requestId === snapshot.requestId) { record.archiveError = 'O trabalho do Codex foi preservado localmente, mas o arquivo no backend falhou.'; await save(record); publish(record) }
      })
    }
    await save(record); publish(record)
  }
}
