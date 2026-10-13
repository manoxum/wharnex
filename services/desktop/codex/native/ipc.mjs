import path from 'node:path'
import { createNativeCodexEngine } from './engine.mjs'
import { publicNativeThread } from './events.mjs'
import { publicCodexThread } from '../events.mjs'
import { registerNativeShutdown } from './recovery/shutdown.mjs'

export function registerNativeCodexIPC(d, { handle, send, accountChanged, legacy, createEngine = createNativeCodexEngine }) {
  let engine
  const runtime = () => engine ||= createEngine({ root: path.join(d.app.getPath('userData'), 'codex', 'native'),
    publishAccount: accountChanged,
    publish: (record) => send(record, 'wharnex:codex:event', publicNativeThread(record)),
    archive: async (record, artifact) => {
      const response = await fetch(new URL(`/api/sessions/${encodeURIComponent(record.sessionId)}/artifacts`, d.BACKEND_URL), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: record.requestId, direction: artifact.direction, kind: artifact.kind,
          filename: artifact.filename, content_type: artifact.contentType, content_base64: artifact.bytes.toString('base64') }),
      })
      if (!response.ok) throw new Error('Arquivo Codex indisponível.')
    },
  })
  registerNativeShutdown(d.app, () => engine)
  async function sessionFor(projectPath, sessionId, chatId) {
    const response = await fetch(new URL(`/api/sessions/${encodeURIComponent(sessionId)}`, d.BACKEND_URL), { redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Não foi possível verificar a sessão Codex.')
    const session = await response.json()
    if (session.project_path !== projectPath || session.chat_id !== chatId) throw new Error('O chat Codex não pertence a esta sessão.')
    if (session.pending_manual_request_ids?.length || session.planner_in_flight || session.interrupted_execution) throw new Error('Encerre o pedido Wharnex pendente antes de usar Codex Native.')
    return session
  }
  handle('native-prepare', async ({ projectPath }, request) => {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(request.cacheKey || '') || !/^req_[A-Za-z0-9_-]{8,180}$/.test(request.requestId || '') || !/^[A-Za-z0-9_-]{1,200}$/.test(request.sessionId || '')) throw new Error('Identidade Codex inválida.')
    if (request.model && (typeof request.model !== 'string' || request.model.length > 160)) throw new Error('Modelo Codex inválido.')
    if (request.effort && (typeof request.effort !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(request.effort))) throw new Error('Esforço Codex inválido.')
    const session = await sessionFor(projectPath, request.sessionId, request.cacheKey)
    return runtime().prepare({ projectPath, cacheKey: request.cacheKey, sessionId: request.sessionId, requestId: request.requestId,
      text: request.text, model: request.model, effort: request.effort, permissionLevel: request.permissionLevel, chatTitle: request.chatTitle,
      attachments: request.attachments, artifacts: request.artifacts, projectFiles: request.projectFiles, selfEvolution: Boolean(session.self_evolution) })
  })
  handle('native-status', async ({ projectPath }) => {
    const current = runtime(), accountId = await current.accounts.selected(), rpc = await current.accounts.runtime(accountId); await rpc.ready()
    const results = await Promise.allSettled([rpc.call('account/read', { refreshToken: false }), rpc.call('account/rateLimits/read'), rpc.call('model/list', { limit: 100 }), rpc.call('account/usage/read')])
    const value = (index) => results[index].status === 'fulfilled' ? results[index].value : null
    const account = value(0)?.account
    if (results[0].status === 'fulfilled') await current.accounts.observe(accountId, account, value(1)?.rateLimits || null)
    const native = await current.list(projectPath)
    const previous = await legacy().list(projectPath)
    return { connected: true, accounts: await current.accounts.list(), account: account ? { type: account.type, email: account.email || '', planType: account.planType || '' } : null,
      rateLimits: value(1)?.rateLimits || null, usage: value(3)?.summary || null,
      models: (value(2)?.data || []).map((model) => ({ id: model.id, model: model.model, label: model.displayName, isDefault: model.isDefault,
        defaultReasoningEffort: model.defaultReasoningEffort, supportedReasoningEfforts: model.supportedReasoningEfforts || [] })),
      threads: [...previous.filter((thread) => !native.some((item) => item.chatId === thread.chatId)), ...native] }
  })
  handle('native-history', async ({ projectPath }, request) => {
    const current = runtime()
    const threads = await current.list(projectPath)
    if (!threads.some((thread) => thread.chatId === request.chatId)) {
      const record = await legacy().owned(projectPath, request.chatId)
      return { ...publicCodexThread(record), native: false, pendingAsks: [] }
    }
    return threads.find((thread) => thread.chatId === request.chatId)
  })
  handle('native-answer', ({ projectPath }, request) => runtime().answer(projectPath, request.chatId, request.requestId, request.askId, request.response))
  handle('native-cancel', ({ projectPath }, request) => runtime().cancel(projectPath, request.chatId, request.requestId))
  handle('native-resume', async ({ projectPath }, request) => {
    const current = runtime(), record = await current.owned(projectPath, request.chatId)
    const session = await sessionFor(projectPath, record.sessionId, record.chatId)
    return current.resume(projectPath, request.chatId, request.requestId, request.text, Boolean(session.self_evolution))
  })
  handle('native-account-create', (_scope, request) => runtime().accounts.create(request.label))
  handle('native-account-select', (_scope, request) => runtime().accounts.select(request.accountId))
  handle('native-login', async () => {
    const accounts = runtime().accounts, rpc = await accounts.runtime(await accounts.selected()); await rpc.ready()
    const result = await rpc.call('account/login/start', { type: 'chatgpt' }), url = new URL(result.authUrl)
    if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com'].includes(url.hostname) || url.username || url.password) throw new Error('URL de autenticação Codex não permitida.')
    await d.shell.openExternal(url.href); return { started: true }
  })
  handle('native-logout', async () => {
    const current = runtime(), accounts = current.accounts, id = await accounts.selected()
    if ((await current.list()).some((thread) => thread.accountId === id && ['submitting', 'running', 'waiting'].includes(thread.status))) throw new Error('Cancele os pedidos ativos desta conta antes de sair.')
    const rpc = await accounts.runtime(id); await rpc.ready(); await rpc.call('account/logout'); await accounts.observe(id, null, null); accountChanged()
  })
  return runtime
}
