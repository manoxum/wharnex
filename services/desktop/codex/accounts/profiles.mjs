import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { transferOwnedRollout } from './rollout.mjs'

export function createCodexAccounts({ root, rpcFactory, handlers }) {
  const filename = path.join(root, 'accounts.json'), runtimes = new Map()
  let state = { selected: 'default', profiles: [{ id: 'default', label: 'CLI / extensão', account: null, rateLimits: null }] }, writes = Promise.resolve()
  const loaded = readFile(filename, 'utf8').then((text) => {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed.profiles) || parsed.profiles.length > 8 || parsed.profiles.some((item) => !/^(?:default|account-[a-f0-9-]{36})$/.test(item.id)) || !parsed.profiles.some((item) => item.id === parsed.selected)) throw new Error('Perfis Codex inválidos.')
    state = parsed
  }).catch((error) => { if (error.code !== 'ENOENT') throw error })
  async function save() {
    const snapshot = JSON.stringify(state)
    const operation = writes.then(async () => { await mkdir(root, { recursive: true, mode: 0o700 }); await writeFile(`${filename}.tmp`, snapshot, { mode: 0o600 }); await rename(`${filename}.tmp`, filename) })
    writes = operation.catch(() => {}); return operation
  }
  function profile(id) {
    const item = state.profiles.find((value) => value.id === id)
    if (!item) throw new Error('Conta Codex desconhecida.')
    return item
  }
  function home(id) { profile(id); return id === 'default' ? process.env.CODEX_HOME || path.join(homedir(), '.codex') : path.join(root, 'profiles', id) }
  async function runtime(id) {
    await loaded; profile(id)
    if (!runtimes.has(id)) {
      const options = { cwd: path.join(root, 'runtime', id), features: { code_mode_host: true, default_mode_request_user_input: true },
        environment: id === 'default' ? {} : { CODEX_HOME: home(id), CODEX_API_KEY: undefined, OPENAI_API_KEY: undefined }, configArgs: id === 'default' ? [] : ['cli_auth_credentials_store="file"'],
        onNotification: (method, params) => {
          if (method === 'account/rateLimits/updated') { profile(id).rateLimits = params.rateLimits; void save().catch(() => {}) }
          if (['account/updated', 'account/login/completed'].includes(method)) handlers.accountChanged()
          handlers.notification(id, method, params)
        }, onRequest: (message) => handlers.request(id, message), onExit: () => handlers.exit(id),
      }
      runtimes.set(id, rpcFactory(options))
    }
    return runtimes.get(id)
  }
  async function selected() { await loaded; return state.selected }
  async function create(label) {
    await loaded
    if (typeof label !== 'string' || !label.trim() || label.length > 80 || /[\x00-\x1f]/.test(label)) throw new Error('Nome da conta Codex inválido.')
    if (state.profiles.length >= 8) throw new Error('O limite é de oito contas Codex.')
    const item = { id: `account-${randomUUID()}`, label: label.trim(), account: null, rateLimits: null }
    state.profiles.push(item); state.selected = item.id; await mkdir(home(item.id), { recursive: true, mode: 0o700 }); await save(); handlers.accountChanged()
    return { id: item.id }
  }
  async function select(id) { await loaded; profile(id); state.selected = id; await save(); handlers.accountChanged(); return { ok: true } }
  async function observe(id, account, rateLimits) {
    await loaded
    Object.assign(profile(id), { account: account ? { type: account.type, email: account.email || '', planType: account.planType || '' } : null, rateLimits })
    await save()
  }
  return { runtime, selected, create, select, observe,
    list: async () => { await loaded; return { selected: state.selected, profiles: structuredClone(state.profiles) } },
    handoff: async (record, targetId) => {
      if ((record.accountId || 'default') === targetId || !record.threadId) return
      const source = await runtime(record.accountId || 'default'); await source.ready()
      const previous = await source.call('thread/read', { threadId: record.threadId, includeTurns: false })
      record.rolloutPath ||= previous.thread?.path
      if (previous.thread?.status?.type === 'active') throw new Error('A conversa ainda está ativa na conta anterior.')
      if (previous.thread?.status?.type === 'idle') await source.call('thread/unsubscribe', { threadId: record.threadId })
      const target = await runtime(targetId); await target.ready()
      const response = await target.call('thread/read', { threadId: record.threadId, includeTurns: false }).catch(() => null)
      if (response?.thread?.status?.type === 'active') throw new Error('A conversa ainda está ativa na conta de destino.')
      if (response?.thread?.status?.type === 'idle') await target.call('thread/unsubscribe', { threadId: record.threadId })
      record.rolloutPath = await transferOwnedRollout(record, home(record.accountId || 'default'), home(targetId))
    },
    close: async () => { await Promise.all([...runtimes.values()].map((rpc) => rpc.stop())); await writes },
  }
}
