import { randomUUID } from 'node:crypto'
import { prepareNativeInput } from '../input.mjs'

export function createNativeSteering({ root, owned, accounts, save, publish, journal }) {
  const pending = new Map()
  async function steer(projectPath, chatId, requestId, commentId, text, attachments = []) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(commentId || '')) throw new Error('Identidade incremental Codex inválida.')
    const key = `${projectPath}:${chatId}`
    const previous = pending.get(key)
    if (previous) {
      if (previous.commentId !== commentId) throw new Error('Aguarde o envio da instrução incremental anterior.')
      return previous.operation
    }
    const operation = deliver().finally(() => pending.delete(key))
    pending.set(key, { commentId, operation })
    return operation

    async function deliver() {
      const record = await owned(projectPath, chatId)
      if (record.requestId !== requestId || !record.turnId || !['running', 'waiting'].includes(record.status)) throw new Error('Não há um turno Codex ativo para esta instrução.')
      const prior = record.steerDeliveries?.find((entry) => entry.id === commentId)
      if (prior?.status === 'sent') return { ok: true }
      if (prior) throw new Error('O envio incremental anterior não foi confirmado. Consulte a conversa antes de reenviar.')
      if ((record.steerDeliveries?.length || 0) >= 256) throw new Error('O pedido atingiu o limite de instruções incrementais.')
      const turnId = record.turnId, threadId = record.threadId, accountId = record.accountId || 'default'
      const target = { ...record }
      const stillOwned = () => record.requestId === requestId && record.turnId === turnId && record.threadId === threadId && (record.accountId || 'default') === accountId
      const prepared = await prepareNativeInput(root, { projectPath, requestId: `req_native_${randomUUID()}`, text, attachments })
      if (!stillOwned() || !['running', 'waiting'].includes(record.status)) throw new Error('O turno Codex terminou antes do envio incremental.')
      const delivery = { id: commentId, status: 'submitting' }
      record.steerDeliveries = [...(record.steerDeliveries || []), delivery]
      await journal.append(target, 'request/steer-requested', { commentId, turnId, text, attachments: prepared.attachments })
      await save(record)
      try {
        const rpc = await accounts.runtime(accountId)
        await rpc.ready()
        if (!stillOwned() || !['running', 'waiting'].includes(record.status)) throw new Error('O turno Codex terminou antes do envio incremental.')
        const result = await rpc.call('turn/steer', { threadId, expectedTurnId: turnId, input: prepared.input })
        if (result.turnId !== turnId || !stillOwned()) throw new Error('O Codex não confirmou o turno incremental esperado.')
        delivery.status = 'sent'
        record.attachments = [...(record.attachments || []), ...prepared.attachments]
        record.messages = [...record.messages, { id: `increment-${commentId}`, role: 'user', text }].slice(-80)
        await journal.append(target, 'request/steered', { commentId, turnId })
        await save(record); publish(record)
        return { ok: true }
      } catch {
        delivery.status = 'attention'
        await journal.append(target, 'request/steer-failed', { commentId, turnId })
        if (stillOwned()) { await save(record); publish(record) }
        throw new Error('O Codex não confirmou o envio incremental. Consulte a conversa antes de reenviar.')
      }
    }
  }
  return { steer, flush: async (record) => { await pending.get(`${record.projectPath}:${record.chatId}`)?.operation.catch(() => {}) } }
}
