import { lazy, Suspense, useEffect, useState } from 'react'
import { desktopBridge, formatBytes } from '../../../lib/desktop/bridge/desktop'
import { parseBundleName, parseBundleNameWithDuplicateSuffix } from '../../../lib/artifacts/bundles/bundlename'
import { api } from '../../../lib/transport/http/api'
import type { ManagedArtifact } from '../../../types'
import type { BrowserMonitorChat } from '../../../lib/transport/http/browser-monitor/catalog'
import { activeTask } from './browserMonitorModel'

const BundleExplorerModal = lazy(() => import('../../artifacts/explorer/BundleExplorer').then(({ BundleExplorerModal: component }) => ({ default: component })))

function executionTaskID(agent: DesktopAgentRuntimeAgent, link?: BrowserMonitorChat) {
  if (link?.kind === 'task') return link.chat_id
  const task = activeTask(agent)
  const chatId = task?.chat_id || agent.chat_id || ''
  return task?.type === 'ORCHESTRATOR_EXECUTE' || /^otk_[A-Za-z0-9_-]+$/.test(chatId) ? chatId : ''
}

type BundleScope = { planningRequest: string; executionTask: string; chatId: string; projectPath: string }

function exchangedBundles(items: ManagedArtifact[], { planningRequest, executionTask, chatId, projectPath }: BundleScope) {
  return items.filter((item) => {
    const artifact = item.artifact
    if (artifact.kind !== 'bundle' || !artifact.bundle) return false
    const parsed = parseBundleName(artifact.name) || parseBundleNameWithDuplicateSuffix(artifact.name)
    if (!parsed || artifact.direction !== (parsed.kind === 'req' ? 'input' : 'output') || artifact.request_id !== (parsed.subrequestId || parsed.requestId)) return false
    if (planningRequest) return Boolean(projectPath) && item.project_path === projectPath && artifact.request_id === planningRequest && parsed.chatId === 'orchestrator'
    if (executionTask) return true // The task-detail endpoint already scopes each file to this task's run lineage.
    return item.chat_id === chatId && parsed.chatId === chatId
  })
    .sort((left, right) => right.artifact.created_at.localeCompare(left.artifact.created_at))
}

function bundleTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function BrowserMonitorBundles({ agent, link, onExplorerOpenChange }: { agent: DesktopAgentRuntimeAgent; link?: BrowserMonitorChat; onExplorerOpenChange: (open: boolean) => void }) {
  const [bundles, setBundles] = useState<ManagedArtifact[]>([])
  const [selected, setSelected] = useState<ManagedArtifact>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const task = activeTask(agent)
  const planningRequest = link?.kind === 'planning' ? link.chat_id : task?.type === 'ORCHESTRATOR_PLAN' ? task.request_id : ''
  const executionTask = executionTaskID(agent, link)
  const ownerSession = executionTask ? link?.session_id || task?.session_id || '' : ''
  const chatId = link?.chat_id || agent.chat_id
  const projectPath = link?.project_path || agent.project_id
  const query = planningRequest || executionTask || chatId

  useEffect(() => () => onExplorerOpenChange(false), [onExplorerOpenChange])

  useEffect(() => {
    if (!query) { setBundles([]); setSelected(undefined); setLoading(false); setError(''); return }
    let alive = true
    const refresh = async () => {
      try {
        if (executionTask && !ownerSession) throw new Error('Sessão da tarefa indisponível para consultar os bundles.')
        const items = executionTask
          ? (await api.orchestratorTaskDetailFiles(ownerSession, executionTask)).files.map((file) => ({
            session_id: file.session_id, project_path: projectPath || '', artifact: file.artifact,
          }))
          : (await api.managedArtifacts(query, true, 'bundle')).artifacts || []
        if (alive) { setBundles(exchangedBundles(items, { planningRequest, executionTask, chatId, projectPath: projectPath || '' })); setError('') }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os bundles.')
      } finally { if (alive) setLoading(false) }
    }
    setBundles([]); setSelected(undefined); setLoading(true)
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 15_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [chatId, projectPath, executionTask, ownerSession, planningRequest, query, link?.key])

  const openExplorer = async (item: ManagedArtifact) => {
    onExplorerOpenChange(true)
    try {
      const bridge = desktopBridge()?.agents
      if (link && agent.id.startsWith('link:')) await bridge?.releaseLinkInMonitor(link.url)
      else await bridge?.releaseFromMonitor(agent.id)
      setSelected(item)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível libertar o navegador.')
      onExplorerOpenChange(false)
    }
  }

  return <section className="mt-6" aria-label="Bundles trocados">
    <div className="mb-2 flex items-center justify-between gap-2 border-b border-whx-border-soft px-1 pb-2">
      <h3 className="text-whx-caption font-semibold uppercase tracking-[0.13em] text-whx-soft">Bundles trocados</h3>
      <span className="rounded-md bg-whx-muted px-2 py-0.5 font-mono text-whx-caption text-whx-faint">{bundles.length}</span>
    </div>
    {!query ? <p className="px-1 py-3 text-whx-caption leading-5 text-whx-faint">Esta instância ainda não tem um chat ou pedido vinculado.</p> : null}
    {loading ? <p className="px-1 py-3 text-whx-caption text-whx-faint" role="status">A carregar bundles…</p> : null}
    {error ? <p className="rounded-lg border border-whx-danger bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] px-3 py-2 text-whx-caption leading-5 text-whx-danger" role="alert">{error}</p> : null}
    {!loading && !error && query && !bundles.length ? <p className="px-1 py-3 text-whx-caption leading-5 text-whx-faint">Nenhum bundle persistido para esta instância.</p> : null}
    <div className="space-y-1.5">{bundles.map((item) => {
      const bundle = item.artifact
      const incoming = bundle.direction === 'output'
      return <button key={`${item.session_id}:${bundle.id}`} type="button" onClick={() => { void openExplorer(item) }} title={`Explorar ${bundle.name}`}
        className="group flex w-full items-start gap-2.5 rounded-lg border border-whx-border-soft bg-whx-muted! px-2.5 py-2 text-left transition hover:border-whx-accent hover:bg-whx-accent!">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-whx-label ${incoming ? 'bg-whx-success text-whx-success' : 'bg-whx-accent text-whx-accent'}`} aria-hidden="true">{incoming ? '↓' : '↑'}</span>
        <span className="min-w-0 flex-1"><span className="block truncate font-mono text-whx-caption leading-relaxed text-whx-text" title={bundle.name}>{bundle.name}</span>
          <span className="mt-0.5 block text-whx-caption text-whx-faint">{incoming ? 'Resposta' : 'Pedido'} · {formatBytes(bundle.size)} · {bundleTime(bundle.created_at)}</span></span>
        <span className="text-whx-caption text-whx-accent opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">Explorar</span>
      </button>
    })}</div>
    {selected ? <Suspense fallback={<p className="px-1 py-3 text-whx-caption text-whx-faint" role="status">A abrir explorador…</p>}><BundleExplorerModal sessionId={selected.session_id} bundle={selected.artifact} onClose={() => { setSelected(undefined); onExplorerOpenChange(false) }} /></Suspense> : null}
  </section>
}
