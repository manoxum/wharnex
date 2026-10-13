import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createCodexEngine } from './engine.mjs'
import { publicCodexThread } from './events.mjs'
import { registerNativeCodexIPC } from './native/index.mjs'

export function registerCodexIPC(d, { createEngine = createCodexEngine } = {}) {
  let engine
  const subscriptions = new Map()
  const send = (record, channel, payload) => {
    for (const { state, projectPath } of subscriptions.values()) {
      if (projectPath === record.projectPath && state.projects.has(projectPath) && !state.window.isDestroyed()) state.window.webContents.send(channel, payload)
    }
  }
  const runtime = () => {
    engine ??= createEngine({ root: path.join(d.app.getPath('userData'), 'codex'),
      materializeChatInput: d.materializeChatInput, withRequestPreparationDeadline: d.withRequestPreparationDeadline,
      publishAccount: () => { for (const { state, projectPath } of subscriptions.values()) if (state.projects.has(projectPath) && !state.window.isDestroyed()) state.window.webContents.send('wharnex:codex:account-changed') },
      publish: (record) => send(record, 'wharnex:codex:event', publicCodexThread(record)),
      deliver: async (record) => {
        const bytes = await readFile(record.outputPath)
        send(record, 'wharnex:codex:bundle', { projectPath: record.projectPath, cacheKey: record.chatId, requestId: record.requestId,
          filename: record.expectedFilename, contentBase64: bytes.toString('base64'), bytes: bytes.length })
      },
    })
    return engine
  }
  d.app.on('before-quit', () => engine?.close())
  function project(event, request) {
    const state = d.trustedSender(event)
    const projectPath = d.canonicalProjectPath(request?.projectPath)
    if (!state.projects.has(projectPath)) throw new Error('Projeto Codex não pertence a esta janela.')
    return { state, projectPath }
  }
  function handle(name, action) {
    d.ipcMain.handle(`wharnex:codex:${name}`, async (event, request) => {
      const scope = project(event, request)
      return action(scope, request || {})
    })
  }
  registerNativeCodexIPC(d, { handle, send, legacy: runtime,
    accountChanged: () => { for (const { state, projectPath } of subscriptions.values()) if (state.projects.has(projectPath) && !state.window.isDestroyed()) state.window.webContents.send('wharnex:codex:account-changed') },
  })
  handle('subscribe', ({ state, projectPath }) => {
    const key = `${state.id}:${projectPath}`
    subscriptions.set(key, { state, projectPath, count: (subscriptions.get(key)?.count || 0) + 1 })
    return { ok: true }
  })
  handle('unsubscribe', ({ state, projectPath }) => {
    const key = `${state.id}:${projectPath}`; const subscription = subscriptions.get(key)
    if (subscription && --subscription.count === 0) subscriptions.delete(key)
    return { ok: true }
  })
  handle('status', async ({ projectPath }) => {
    const current = runtime(); await current.rpc.ready()
    const results = await Promise.allSettled([
      current.rpc.call('account/read', { refreshToken: false }),
      current.rpc.call('account/rateLimits/read'), current.rpc.call('model/list', { limit: 100 }),
      current.rpc.call('account/usage/read'),
    ])
    const value = (index) => results[index].status === 'fulfilled' ? results[index].value : null
    const account = value(0)?.account
    return { connected: true, account: account ? { type: account.type, email: account.email || '', planType: account.planType || '' } : null,
      rateLimits: value(1)?.rateLimits || null, usage: value(3)?.summary || null,
      models: (value(2)?.data || []).map((model) => ({ id: model.id, model: model.model, label: model.displayName, isDefault: model.isDefault })),
      threads: await current.list(projectPath) }
  })
  handle('login', async () => {
    const current = runtime(); await current.rpc.ready()
    const result = await current.rpc.call('account/login/start', { type: 'chatgpt' })
    const url = new URL(result.authUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com') throw new Error('URL de autenticação Codex não permitida.')
    await d.shell.openExternal(url.href)
    return { started: true }
  })
  handle('logout', async () => {
    const current = runtime(); await current.rpc.ready()
    return current.rpc.call('account/logout')
  })
  handle('prepare', async ({ projectPath }, request) => {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(request.cacheKey || '') || !/^req_[A-Za-z0-9_-]{8,180}$/.test(request.requestId || '')) throw new Error('Identidade de pedido Codex inválida.')
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(request.sessionId || '')) throw new Error('Sessão Codex inválida.')
    const response = await fetch(new URL(`/api/sessions/${encodeURIComponent(request.sessionId)}`, d.BACKEND_URL), { redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Não foi possível verificar a sessão Codex.')
    const session = await response.json()
    if (session.project_path !== projectPath || session.chat_id !== request.cacheKey || !session.pending_manual_request_ids?.includes(request.requestId)) throw new Error('Pedido Codex não pertence à sessão e ao chat indicados.')
    if (typeof request.model !== 'undefined' && (typeof request.model !== 'string' || request.model.length > 160)) throw new Error('Modelo Codex inválido.')
    return runtime().prepare({ ...request, projectPath, text: session.last_manual_prompt, contextSha256: session.context.workspace_sha256 || session.context.manifest.sha256 })
  })
  handle('threads', ({ projectPath }) => runtime().list(projectPath))
  handle('history', async ({ projectPath }, request) => {
    const current = runtime(); const record = await current.owned(projectPath, request.chatId)
    await current.rpc.ready()
    const result = await current.rpc.call('thread/read', { threadId: record.threadId, includeTurns: true })
    const messages = (result.thread?.turns || []).flatMap((turn) => (turn.items || []).filter((item) => item.type === 'agentMessage').map((item) => ({ id: item.id, text: String(item.text || '').slice(0, 65536) }))).slice(-40)
    return { ...publicCodexThread(record), messages: record.messages?.length ? record.messages : messages }
  })
  handle('cancel', ({ projectPath }, request) => runtime().cancel(projectPath, request.chatId, request.requestId))
  handle('pending', ({ projectPath }) => runtime().pending(projectPath))
  handle('acknowledge', ({ projectPath }, request) => runtime().acknowledge(projectPath, request.chatId, request.requestId))
}
