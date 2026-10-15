import { randomUUID } from 'node:crypto'
import { normalizeNativeRecovery } from './recovery/state.mjs'
import { nativePermissionPolicy } from './permissions.mjs'

export function createNativeContinuation({ owned, accounts, save, publish, interactions, journal, prepare, flush = async () => {} }) {
  const locks = new Set()
  return async function resume(projectPath, chatId, requestId, text, selfEvolution) {
    const key = `${projectPath}:${chatId}`
    if (locks.has(key)) throw new Error('A continuação Codex já está a ser preparada.')
    locks.add(key)
    let record
    try {
      record = await owned(projectPath, chatId)
      normalizeNativeRecovery(record)
      if (record.requestId !== requestId || !record.resumeAvailable || !['attention', 'idle'].includes(record.status)) throw new Error('Este pedido Codex não está disponível para continuação manual.')
      text ??= record.threadId ? 'Continue o pedido anterior a partir do estado atual. Verifique o que já foi feito antes de prosseguir.' : [...(record.messages || [])].reverse().find((message) => message.role === 'user')?.text || ''
      if (typeof text !== 'string' || !text.trim() || text.length > 262144) throw new Error('Não há instruções válidas para continuar. Envie um novo pedido no chat.')
      if (record.threadId) {
        const rpc = await accounts.runtime(record.accountId || 'default'); await rpc.ready()
        const history = await rpc.call('thread/read', { threadId: record.threadId, includeTurns: false })
        record.rolloutPath ||= history.thread?.path
        if (history.thread?.status?.type === 'active') {
          if (!record.turnId) throw new Error('A conversa Codex ainda está ativa.')
          await rpc.call('turn/interrupt', { threadId: record.threadId, turnId: record.turnId })
          const settled = await rpc.call('thread/read', { threadId: record.threadId, includeTurns: false })
          if (settled.thread?.status?.type === 'active') throw new Error('Aguarde o fim da interrupção antes de continuar.')
        }
        // Acquire the owned writer before replacing request identity. A different
        // client can hold it even when this runtime reports the thread notLoaded.
        await rpc.call('thread/resume', { threadId: record.threadId, cwd: record.projectPath || projectPath,
          model: record.model || null, excludeTurns: true, ...nativePermissionPolicy(record.permissionLevel).thread })
      }
      await flush()
      interactions.retire(record)
      await journal.append(record, 'request/manual-continuation', { previousRequestId: requestId, targetAccountId: await accounts.selected() })
      record.status = 'idle'; await save(record); publish(record)
      return await prepare({ projectPath, cacheKey: chatId, sessionId: record.sessionId, requestId: `req_native_${randomUUID().replaceAll('-', '')}`,
        text, chatTitle: record.title, model: record.model, effort: record.effort, permissionLevel: record.permissionLevel || 'full', selfEvolution,
        attachments: [], projectFiles: [], gitBaseline: record.gitBaseline, nativeChangedPaths: record.nativeChangedPaths })
    } catch (error) {
      console.warn(`[codex] native continuation refused chat=${chatId} request=${requestId} reason=${error.reason || 'continuationFailed'}`)
      if (record?.requestId === requestId) await journal.append(record, 'request/continuation-failed', {
        reason: error.reason || 'continuationFailed', code: Number(error.code) || 0,
      }).catch(() => {})
      throw error
    } finally { locks.delete(key) }
  }
}
