import { randomUUID } from 'node:crypto'

const kinds = {
  'item/tool/requestUserInput': 'questions',
  'item/commandExecution/requestApproval': 'command',
  'item/fileChange/requestApproval': 'files',
  'item/permissions/requestApproval': 'permissions',
}
export function createNativeInteractions({ find, save, publish, journal }) {
  const pending = new Map()
  async function request(message) {
    const params = message.params || {}
    const record = find(params.threadId)
    const kind = kinds[message.method]
    if (!kind || !record || !['submitting', 'running', 'waiting'].includes(record.status) || (record.turnId && record.turnId !== params.turnId)) throw new Error('Pedido Codex sem proprietário ativo.')
    const questions = params.questions || []
    if (kind === 'questions' && (!questions.length || questions.length > 8 || new Set(questions.map((q) => q.id)).size !== questions.length)) throw new Error('Perguntas Codex inválidas.')
    const ask = { id: randomUUID(), kind, turnId: params.turnId, itemId: params.itemId, questions,
      reason: params.reason || '', command: params.command || '', cwd: params.cwd || '', permissions: params.permissions || null,
      availableDecisions: (params.availableDecisions || ['accept', 'decline', 'cancel']).filter((value) => typeof value === 'string') }
    let resolve, reject
    const response = new Promise((yes, no) => { resolve = yes; reject = no })
    // Cancellation may arrive while the request is being durably recorded.
    // Attach a handler now; the returned promise still rejects for the caller.
    void response.catch(() => {})
    // Keep the resolver before publishing: a fast renderer reply must find it.
    pending.set(ask.id, { record, ask, resolve, reject, serverId: message.id })
    record.pendingAsks = [...(record.pendingAsks || []), ask]
    record.status = 'waiting'
    try {
      await journal.append(record, message.method, { ...params, questions: questions.map((q) => ({ ...q, isSecret: Boolean(q.isSecret) })) })
      await save(record); publish(record)
    } catch (error) { pending.delete(ask.id); record.pendingAsks = record.pendingAsks.filter((item) => item.id !== ask.id); throw error }
    return response
  }
  async function answer(record, askId, value) {
    const item = pending.get(askId)
    if (!item || item.record !== record || (record.turnId && item.ask.turnId !== record.turnId)) throw new Error('Esta pergunta Codex já não está pendente.')
    let response
    if (item.ask.kind === 'questions') {
      const answers = value?.answers
      if (!answers || Object.keys(answers).some((id) => !item.ask.questions.some((q) => q.id === id))) throw new Error('Respostas Codex inválidas.')
      for (const question of item.ask.questions) {
        const selected = answers[question.id]?.answers
        if (!Array.isArray(selected) || !selected.length || selected.length > 8 || selected.some((text) => typeof text !== 'string' || !text.trim() || text.length > 16384)) throw new Error('Responda a todas as perguntas Codex.')
      }
      for (const question of item.ask.questions) if (question.isSecret) for (const text of answers[question.id].answers) journal.protectSecret(text)
      response = { answers }
    } else {
      const decision = value?.decision
      if (!['accept', 'decline', 'cancel'].includes(decision) || (item.ask.kind !== 'permissions' && !item.ask.availableDecisions.includes(decision))) throw new Error('Decisão Codex inválida.')
      response = item.ask.kind === 'permissions'
        ? { permissions: decision === 'accept' ? item.ask.permissions : {}, scope: 'turn' }
        : { decision }
    }
    // Never journal answers: even free text can contain a credential.
    const previousAsks = record.pendingAsks, previousStatus = record.status
    record.pendingAsks = record.pendingAsks.filter((ask) => ask.id !== askId)
    if (!record.pendingAsks.length && record.status === 'waiting') record.status = 'running'
    try { await save(record) }
    catch (error) { record.pendingAsks = previousAsks; record.status = previousStatus; throw error }
    if (!pending.has(askId)) throw new Error('Pergunta Codex encerrada durante a resposta.')
    pending.delete(askId); item.resolve(response); publish(record)
    await journal.append(record, 'interaction/answered', { askId, kind: item.ask.kind })
    return { ok: true }
  }
  function retire(record, serverId) {
    const retired = new Set()
    for (const [id, entry] of pending) if (entry.record === record && (serverId === undefined || entry.serverId === serverId)) {
      entry.reject(new Error('Pergunta Codex encerrada.')); pending.delete(id); retired.add(id)
    }
    record.pendingAsks = (record.pendingAsks || []).filter((ask) => !retired.has(ask.id))
    if (!record.pendingAsks.length && record.status === 'waiting') record.status = 'running'
  }
  return { request, answer, retire }
}
