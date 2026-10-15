import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { CodexRPC } from './rpc.mjs'
import { createCodexState } from './state.mjs'
import { ARCHIVE_TOOLS, createArchiveTools } from './archive-tools.mjs'
import { plannerConfiguration, PLANNER_INSTRUCTIONS } from './config.mjs'
import { createCodexEvents, publicCodexThread } from './events.mjs'
import { retainLogicalInput } from './input.mjs'
import { canonicalWharnexBundleDownload } from '../security/bundle-files.mjs'

export function createCodexEngine({ root, materializeChatInput, withRequestPreparationDeadline, publish, deliver, publishAccount = () => {}, rpcFactory = (options) => new CodexRPC(options) }) {
  const store = createCodexState(root)
  let records = []
  const tools = new Map()
  const locks = new Map()
  const loaded = store.load().then(async (values) => {
    await mkdir(path.join(root, 'workspace'), { recursive: true, mode: 0o700 })
    records = values
    for (const item of records) {
      item.messages ||= []
      if (['submitting', 'running'].includes(item.status)) {
        item.status = 'attention'; item.error = 'Execução interrompida pelo reinício. Consulte a conversa antes de reenviar.'
      }
    }
  })
  const notification = createCodexEvents({ records: () => records, save: store.save, publish, deliver })
  const rpc = rpcFactory({
    cwd: path.join(root, 'workspace'),
    onNotification: (method, params) => {
      if (['account/updated', 'account/login/completed'].includes(method)) publishAccount()
      void loaded.then(() => notification(method, params)).catch(() => console.warn('[codex] notification processing failed', { method, thread_id: params.threadId || '' })) },
    onRequest: async (message) => {
      if (message.method !== 'item/tool/call') throw new Error('Only archive tools are allowed')
      const record = records.find((item) => item.threadId === message.params?.threadId && ['running', 'submitting'].includes(item.status))
      const handler = record && (!record.turnId || record.turnId === message.params.turnId) && tools.get(record.threadId)
      if (!handler) throw new Error('No active owned Codex request')
      try { return await handler(message.params.tool, message.params.arguments) }
      catch { return { success: false, contentItems: [{ type: 'inputText', text: 'Archive operation refused. Check the entry path, UTF-8 content and documented size limits; no host access is allowed.' }] } }
    },
    onExit: () => { for (const record of records) if (['submitting', 'running'].includes(record.status)) {
      record.status = 'attention'; record.error = 'Ligação ao Codex interrompida. O pedido foi preservado.'
      void store.save(record).then(() => publish(record)).catch(() => {})
    } },
  })

  async function prepare(request) {
    await loaded
    const key = `${request.projectPath}:${request.cacheKey}`
    const locked = locks.get(key)
    if (locked) {
      if (locked.requestId !== request.requestId) throw new Error('O chat Codex está a preparar outro pedido.')
      return locked.promise
    }
    const operation = prepareOwned(request).finally(() => locks.delete(key))
    locks.set(key, { requestId: request.requestId, promise: operation })
    return operation
  }

  async function prepareOwned(request) {
    await rpc.ready()
    let record = records.find((item) => item.projectPath === request.projectPath && item.chatId === request.cacheKey)
    if (record?.requestId === request.requestId && record.status !== 'idle') {
      if (record.status === 'ready') await deliver(record)
      if (record.status === 'attention') throw new Error(record.error || 'Pedido Codex requer atenção; cancele antes de repetir.')
      return prepared(record)
    }
    if (record && ['submitting', 'running', 'ready', 'attention'].includes(record.status)) throw new Error('O chat Codex já tem um pedido pendente. Cancele-o antes de iniciar outro.')
    if (!canonicalWharnexBundleDownload(request.expectedFilename, request.requestId, 'application/zip', request.cacheKey, request.expectedFilename)) throw new Error('Nome de resposta Codex inválido.')
    await mkdir(path.join(root, 'workspace'), { recursive: true, mode: 0o700 })
    const { config } = await rpc.call('config/read', { includeLayers: false })
    const params = { cwd: path.join(root, 'workspace'), approvalPolicy: 'never', sandbox: 'read-only',
      model: request.model || null, config: plannerConfiguration(config), baseInstructions: PLANNER_INSTRUCTIONS,
      dynamicTools: ARCHIVE_TOOLS }
    const thread = record?.threadId
      ? await rpc.call('thread/resume', { ...params, threadId: record.threadId })
      : await rpc.call('thread/start', params)
    if (!record) {
      record = { projectPath: request.projectPath, chatId: request.cacheKey, messages: [] }
      records.push(record)
    }
    Object.assign(record, { threadId: thread.thread.id, model: request.model || thread.model,
      title: String(request.chatTitle || 'Codex').slice(0, 160), sessionId: request.sessionId,
      requestId: request.requestId, expectedFilename: request.expectedFilename, status: 'submitting', turnId: '', error: '', outputPath: '' })
    if (request.bootstrapText) record.messages = [...record.messages, { id: request.requestId, role: 'user', text: String(request.bootstrapText).slice(0, 65536) }].slice(-40)
    await rpc.call('thread/name/set', { threadId: record.threadId, name: record.title }).catch(() => console.warn('[codex] thread naming failed', { chat_id: record.chatId }))
    await store.save(record)
    try {
      const input = await withRequestPreparationDeadline(undefined, (signal) => materializeChatInput(
        request.cacheKey, request.sessionId, request.requestId, request.attachments || [], request.artifacts || [],
        request.text, true, request.projectFiles || [], { chat_id: request.cacheKey, chat_title: record.title,
          chat_hash: request.contextSha256, requested_at: request.requestedAt || '' }, signal))
      record.inputPath = await retainLogicalInput(input, root, request.requestId)
      if (record.status !== 'submitting' || record.requestId !== request.requestId) throw new Error('Pedido Codex cancelado durante a preparação.')
      tools.set(record.threadId, createArchiveTools({ inputPath: record.inputPath, outputRoot: root,
        expectedFilename: record.expectedFilename, onCreated: async (outputPath) => {
          if (record.requestId !== request.requestId || !['submitting', 'running'].includes(record.status)) { await rm(outputPath, { force: true }); throw new Error('Pedido Codex cancelado.') }
          record.outputPath = outputPath; await store.save(record)
        } }))
      // Save before submission: a timeout is uncertain and must never auto-resubmit.
      await store.save(record)
      const result = await rpc.call('turn/start', { threadId: record.threadId, approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly' },
        effort: request.reasoningEffort === 'instant' ? 'low' : request.reasoningEffort || 'high', input: [{ type: 'text', text:
          `WHARNEX INPUT ${request.requestId}\nRead the current request ZIP using wharnex_archive_read. Open transport.json and prompt/wharness-planner-prompt.md first. Create exactly ${record.expectedFilename} using wharnex_archive_create.` }] })
      if (record.status === 'idle' || record.requestId !== request.requestId) {
        await rpc.call('turn/interrupt', { threadId: record.threadId, turnId: result.turn.id })
        throw new Error('Pedido Codex cancelado durante o envio.')
      }
      record.turnId = result.turn.id
      if (record.status === 'submitting') record.status = 'running'
      await store.save(record); publish(record)
      console.info('[codex] request submitted', { chat_id: record.chatId, session_id: record.sessionId, request_id: record.requestId })
      return prepared(record)
    } catch (error) {
      if (record.status === 'idle' || record.requestId !== request.requestId) throw error
      record.status = 'attention'; record.error = 'Não foi possível confirmar a entrega ao Codex. Consulte a conversa ou cancele o pedido.'
      await store.save(record); publish(record); throw error
    }
  }

  function prepared(record) { return { ok: true, cacheKey: record.chatId, submitted: true, attachmentCount: 1, includedContext: true, expectedFilename: record.expectedFilename } }
  async function list(projectPath) { await loaded; return records.filter((item) => item.projectPath === projectPath).map(publicCodexThread) }
  async function owned(projectPath, chatId) {
    await loaded
    const record = records.find((item) => item.projectPath === projectPath && item.chatId === chatId)
    if (!record) throw new Error('Chat Codex não pertence a este projeto.')
    return record
  }
  async function cancel(projectPath, chatId, requestId) {
    const record = await owned(projectPath, chatId)
    if (record.requestId !== requestId) throw new Error('Pedido Codex não corresponde ao chat.')
    if (record.turnId && ['running', 'submitting', 'attention'].includes(record.status)) {
      await rpc.ready()
      try { await rpc.call('turn/interrupt', { threadId: record.threadId, turnId: record.turnId }) }
      catch (error) {
        if (error.code !== -32600) throw error
        const history = await rpc.call('thread/read', { threadId: record.threadId, includeTurns: true })
        const turn = history.thread?.turns?.find((item) => item.id === record.turnId)
        if (!turn || !['completed', 'interrupted', 'failed'].includes(turn.status)) throw error
      }
    }
    record.status = 'idle'; tools.delete(record.threadId); await store.save(record)
    await Promise.all([record.outputPath, record.inputPath].filter(Boolean).map((file) => rm(file, { force: true })))
    publish(record)
    return { ok: true }
  }
  async function pending(projectPath) {
    await loaded
    return Promise.all(records.filter((item) => item.projectPath === projectPath && item.status === 'ready').map(async (item) => {
      const bytes = await readFile(item.outputPath)
      return { projectPath: item.projectPath, cacheKey: item.chatId, requestId: item.requestId, filename: item.expectedFilename, contentBase64: bytes.toString('base64'), bytes: bytes.length }
    }))
  }
  async function acknowledge(projectPath, chatId, requestId) {
    const record = await owned(projectPath, chatId)
    if (record.requestId !== requestId || record.status !== 'ready') throw new Error('Bundle Codex não está pendente.')
    record.status = 'idle'; tools.delete(record.threadId); await store.save(record)
    await Promise.all([record.outputPath, record.inputPath].filter(Boolean).map((file) => rm(file, { force: true })))
    publish(record); return { ok: true }
  }
  return { rpc, prepare, list, owned, cancel, pending, acknowledge, close: () => rpc.stop() }
}
