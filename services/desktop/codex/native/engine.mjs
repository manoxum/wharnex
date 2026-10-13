import path from 'node:path'
import { CodexRPC } from '../rpc.mjs'
import { createCodexState } from '../state.mjs'
import { prepareNativeInput } from './input.mjs'
import { createNativeJournal } from './journal.mjs'
import { createNativeInteractions } from './interactions.mjs'
import { createNativeEvents, publicNativeThread } from './events.mjs'
import { createCodexAccounts } from '../accounts/index.mjs'
import { nativePermissionPolicy } from './permissions.mjs'
import { createNativeContinuation } from './continuation.mjs'
import { normalizeNativeRecovery } from './recovery/state.mjs'

const ACTIVE = new Set(['submitting', 'running', 'waiting', 'attention'])
export function createNativeCodexEngine({ root, publish: onPublish, publishAccount = () => {}, archive, rpcFactory = (options) => new CodexRPC(options) }) {
  const store = createCodexState(root)
  const journal = createNativeJournal(root, { archive })
  const publish = (record) => onPublish(journal.sanitize(record))
  const locks = new Map()
  let records = [], events = Promise.resolve()
  const save = (record) => store.save(journal.sanitize(record))
  const loaded = store.load().then(async (values) => {
    records = values.map((record) => ({ ...record, pendingAsks: [] }))
    for (const record of records) {
      if (['submitting', 'running', 'waiting'].includes(record.status)) {
        record.status = 'attention'; record.resumeAvailable = true; record.pauseReason = 'restart'; record.error = 'O Desktop reiniciou durante o pedido. Pode continuar manualmente na mesma conversa.'
        await save(record)
      } else if (normalizeNativeRecovery(record)) await save(record)
    }
  })
  const find = (id, accountId) => records.find((record) => record.threadId === id && (!accountId || (record.accountId || 'default') === accountId))
  const interactions = createNativeInteractions({ find, save, publish, journal })
  const notification = createNativeEvents({ find, save, publish, journal, interactions })
  const accounts = createCodexAccounts({ root: path.join(root, 'accounts'), rpcFactory, handlers: {
    accountChanged: publishAccount,
    notification: (accountId, method, params) => {
      events = events.then(() => loaded).then(() => { if (!params.threadId || find(params.threadId, accountId)) return notification(method, params) }).catch(() => console.warn('[codex] native event could not be recorded', { method }))
    },
    request: async (accountId, message) => { await loaded; await events; if (!find(message.params?.threadId, accountId)) throw new Error('Conta Codex não pertence ao pedido.'); return interactions.request(message) },
    exit: (accountId) => {
      events = events.then(() => loaded).then(async () => { for (const record of records) if ((record.accountId || 'default') === accountId && ['submitting', 'running', 'waiting'].includes(record.status)) {
        interactions.retire(record); record.status = 'attention'; record.resumeAvailable = true; record.pauseReason = 'disconnect'; record.error = 'Ligação ao Codex interrompida. Pode continuar manualmente na mesma conversa.'
        await journal.append(record, 'runtime/disconnected', {}); await save(record); publish(record)
      } }).catch(() => {})
    },
  } })
  const rpc = { ready: async () => (await accounts.runtime(await accounts.selected())).ready(), call: async (method, params) => (await accounts.runtime(await accounts.selected())).call(method, params) }
  async function owned(projectPath, chatId) {
    await loaded
    const record = records.find((item) => item.projectPath === projectPath && item.chatId === chatId)
    if (!record) throw new Error('Chat Codex não pertence a este projeto.')
    return record
  }
  async function prepare(request) {
    await loaded
    const key = `${request.projectPath}:${request.cacheKey}`
    const previous = locks.get(key)
    if (previous) {
      if (previous.id !== request.requestId) throw new Error('O chat Codex está a preparar outro pedido.')
      return previous.operation
    }
    const operation = submit(request).finally(() => locks.delete(key))
    locks.set(key, { id: request.requestId, operation })
    return operation
  }
  async function submit(request) {
    let record = records.find((item) => item.projectPath === request.projectPath && item.chatId === request.cacheKey)
    if (record?.requestId === request.requestId) {
      if (record.status === 'attention') throw new Error(record.error)
      return prepared(record)
    }
    if (record && ACTIVE.has(record.status)) throw new Error('O Codex tem um pedido pendente. Responda às perguntas ou cancele-o antes de enviar outro.')
    const accountId = await accounts.selected(), policy = nativePermissionPolicy(request.permissionLevel)
    if (record) await accounts.handoff(record, accountId)
    record ||= { projectPath: request.projectPath, chatId: request.cacheKey, messages: [] }
    if (!records.includes(record)) records.push(record)
    Object.assign(record, { native: true, accountId, permissionLevel: policy.level, effort: request.effort, selfEvolution: Boolean(request.selfEvolution), resumeAvailable: false, pauseReason: '', sessionId: request.sessionId, requestId: request.requestId,
      status: 'submitting', error: '', archiveError: '', turnId: '', pendingAsks: [], activities: [], startedAt: new Date().toISOString(), completedAt: '', title: String(request.chatTitle || 'Codex').slice(0, 160) })
    record.messages = [...record.messages, { id: request.requestId, role: 'user', text: request.text }].slice(-80)
    await save(record); publish(record)
    try {
      const preparedInput = await prepareNativeInput(root, request)
      record.attachments = preparedInput.attachments
      await journal.append(record, 'request/submitted', { prompt: request.text, attachments: preparedInput.attachments, references: preparedInput.references })
      const rpc = await accounts.runtime(accountId)
      await rpc.ready()
      const params = { cwd: request.projectPath, ...policy.thread, model: request.model || null }
      const result = record.threadId ? await rpc.call('thread/resume', { ...params, threadId: record.threadId, excludeTurns: true }) : await rpc.call('thread/start', params)
      record.threadId = result.thread.id; record.rolloutPath = result.thread.path || record.rolloutPath; record.model = result.model || request.model
      await rpc.call('thread/name/set', { threadId: record.threadId, name: record.title }).catch(() => {})
      if (record.status !== 'submitting') throw new Error('Pedido Codex cancelado durante a preparação.')
      await save(record)
      const turn = await rpc.call('turn/start', { threadId: record.threadId, cwd: request.projectPath, ...policy.turn,
        ...(request.effort ? { effort: request.effort } : {}), input: preparedInput.input })
      if (record.status === 'idle') { await rpc.call('turn/interrupt', { threadId: record.threadId, turnId: turn.turn.id }); throw new Error('Pedido Codex cancelado durante o envio.') }
      record.turnId = turn.turn.id
      if (record.status === 'submitting') record.status = 'running'
      await save(record); publish(record)
      console.info(`[codex] native request submitted chat=${record.chatId} request=${record.requestId} session=${record.sessionId}`)
      return prepared(record)
    } catch (error) {
      if (record.status !== 'idle') { record.status = 'attention'; record.resumeAvailable = true; record.pauseReason = 'submission'; record.error = 'Não foi possível confirmar o envio ao Codex. Consulte a conversa antes de continuar manualmente.'; await save(record); publish(record) }
      throw error
    }
  }
  function prepared(record) { return { ok: true, cacheKey: record.chatId, submitted: true, attachmentCount: record.attachments?.length || 0, includedContext: false } }
  async function cancel(projectPath, chatId, requestId) {
    const record = await owned(projectPath, chatId)
    if (record.requestId !== requestId) throw new Error('Pedido Codex já não está ativo.')
    if (record.turnId && ACTIVE.has(record.status)) {
      const rpc = await accounts.runtime(record.accountId || 'default')
      await rpc.ready()
      try { await rpc.call('turn/interrupt', { threadId: record.threadId, turnId: record.turnId }) }
      catch (error) {
        if (error.code !== -32600) throw error
        const history = await rpc.call('thread/read', { threadId: record.threadId, includeTurns: true })
        if (!history.thread?.turns?.some((turn) => turn.id === record.turnId && ['completed', 'failed', 'interrupted'].includes(turn.status))) throw error
      }
    }
    interactions.retire(record); record.status = 'idle'; record.resumeAvailable = true; record.pauseReason = 'cancelled'; record.error = ''
    await journal.append(record, 'request/cancelled', {}); await save(record); publish(record)
    return { ok: true }
  }
  const resume = createNativeContinuation({ owned, accounts, save, publish, interactions, journal, prepare, flush: () => events })
  return { rpc, accounts, prepare, owned, cancel, resume,
    answer: async (projectPath, chatId, requestId, askId, value) => {
      const record = await owned(projectPath, chatId)
      if (record.requestId !== requestId) throw new Error('Resposta pertence a outro pedido Codex.')
      return interactions.answer(record, askId, value)
    },
    list: async (projectPath) => { await loaded; return records.filter((record) => !projectPath || record.projectPath === projectPath).map((record) => publicNativeThread(journal.sanitize(record))) },
    flush: () => events,
    close: async () => { for (const record of records) interactions.retire(record); await accounts.close(); await events; await journal.flush() },
  }
}
