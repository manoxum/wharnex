import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { AppConfig, ChatGPTActivity, HarnessEvent, Session } from '../types'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { riskLabel } from '../lib/risk'
import { api } from '../lib/api'
import { isDesktop } from '../lib/desktop'
import { ChatGPTDesktopPane } from './ChatGPTDesktopPane'
import { DirectChatGPTPane } from './DirectChatGPTPane'
import { MarkdownContent } from './MarkdownContent'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { buildExecutionTimeline } from '../lib/executionTimeline'

export type InspectorTab = 'plan' | 'terminal' | 'chatgpt' | 'direct-chatgpt'

export function Inspector({ config, session, events, manualPrompt, busy, chat, chatgptSurface, chatgptSuspended = false, activeTab, onTabChange, embedded = false, onChatGPTURL, onChatGPTActivity, onTransportFailure, onCancelPendingRequest, onExecute, onApply, onRejectPendingChanges, onManualPlan, onPlanFile, onBundleFile }: {
  config?: AppConfig
  session: Session
  events: HarnessEvent[]
  manualPrompt: string
  busy: boolean
  chat?: WorkspaceChat
  chatgptSurface?: { cacheKey: string; title: string; url?: string; conflictId?: string }
  chatgptSuspended?: boolean
  activeTab?: InspectorTab
  onTabChange?: (tab: InspectorTab) => void
  embedded?: boolean
  onChatGPTURL: (url: string) => boolean
  onChatGPTActivity?: (activity: ChatGPTActivity) => void
	 onTransportFailure?: (requestId: string, reason: string) => void
  onCancelPendingRequest?: (requestId: string) => Promise<void>
  onContextSent?: (sha256: string, conversationUrl?: string) => void
  onExecute: (approved: boolean) => Promise<void>
  onRetryDependencyNetwork?: () => Promise<void>
  onApply: () => Promise<void>
  onRejectPendingChanges?: () => Promise<void>
  onManualPlan: (json: string) => Promise<void>
  onPlanFile: (json: string, requestId: string) => Promise<string>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
  onSession: (session: Session) => void
}) {
  const [tab, setTab] = useState<InspectorTab>(config?.planner === 'manual' ? 'chatgpt' : 'plan')
  const selectedTab = activeTab ?? tab
  const selectTab = (next: InspectorTab) => { if (activeTab === undefined) setTab(next); onTabChange?.(next) }
  const [manualJSON, setManualJSON] = useState('')
  useEffect(() => { setManualJSON('') }, [chat?.id])
  const terminalEvents = useMemo(() => events.filter((e) => ['execution.queued', 'execution.dequeued', 'execution.started', 'execution.completed', 'execution.failed', 'execution.duplicate_blocked', 'execution.recovery_discarded', 'execution.recovery_reconciled', 'automation.execution_failed', 'automation.infrastructure_blocked', 'command.started', 'command.output', 'command.completed', 'patch.started', 'patch.applied', 'host.apply_started', 'host.apply_failed', 'host.applied', 'host.pending_rejected', 'host.revert_started', 'host.reverted', 'self_evolution.host_build_started', 'self_evolution.host_build_output', 'self_evolution.host_build_completed', 'self_evolution.host_build_failed', 'verification.started', 'verification.completed', 'verification.baseline_unchanged', 'verification.baseline_changed', 'automation.policy_blocked', 'automation.approval_required', 'repair.started', 'repair.prompt_ready', 'repair.prepare_failed', 'workflow.started', 'workflow.completed', 'workflow.step_failed', 'workflow.policy_blocked', 'workflow.continuation_started', 'workflow.prompt_ready', 'baseline.peer_updated', 'baseline.continuation_ready', 'baseline.bundle_fast_forwarded', 'baseline.bundle_superseded', 'baseline.execution_fast_forwarded', 'baseline.candidate_reverified', 'baseline.apply_blocked', 'baseline.reverify_failed', 'changeset.base_restored', 'changeset.verified', 'changeset.replayed', 'changeset.integrated', 'integration.verification_started', 'integration.verification_baseline_unchanged', 'integration.verification_baseline_compare_failed', 'integration.race', 'self_evolution.transaction_aborted', 'conflict.prompt_ready'].includes(e.type)), [events])
  const canExecute = Boolean(session.plan && session.policy?.allowed && ['planned', 'failed'].includes(session.state) && session.last_turn?.kind !== 'workflow')
  const needsApproval = Boolean(session.policy?.requires_approval)
  const direct = session.execution_mode === 'unprotected'
  const pendingCount = session.pending_host_changes?.length || 0
  const pendingResolutionBlocked = Boolean(session.planner_in_flight || session.pending_manual_request_ids?.length || ['awaiting_plan', 'workflow_pending', 'workflow_planned', 'workflow_observed', 'repair_pending', 'planned', 'baseline_update_pending', 'conflict_resolution_pending'].includes(session.state))
  const canApply = Boolean(!direct && pendingCount && !pendingResolutionBlocked && session.last_turn?.kind !== 'workflow')
  const canReject = canApply || Boolean(!direct && pendingCount && session.integration_conflict)
  const desktop = isDesktop()

  async function copy(text: string) { await navigator.clipboard.writeText(text) }
  async function importPlanFile(json: string, requestId: string) {
    const message = await onPlanFile(json, requestId)
    selectTab('plan')
    return message
  }
  return (
    <section className={`inspector-panel ${embedded ? 'embedded' : ''}`}>
      {!embedded && <header className="panel-header inspector-header">
        <div className="brand-lockup small"><div className="brand-mark">K</div><div><strong>Agent Inspector</strong><span>{config?.planner || 'planner'} · {config?.sandbox || 'sandbox'}{desktop ? ' · desktop' : ''}</span></div></div>
        <div className="header-actions">
          {session.policy && <StatusPill tone={session.policy.allowed ? (session.policy.risk === 'high' ? 'warning' : 'accent') : 'danger'}>{riskLabel(session.policy.risk)}</StatusPill>}
          {direct && <StatusPill tone="warning">Unprotected</StatusPill>}
          {session.automation_mode === 'auto' && <StatusPill tone="success">Auto</StatusPill>}
          {canExecute && <button className={direct ? 'danger-button' : 'secondary-button'} disabled={busy} onClick={() => onExecute(needsApproval || direct)}><Icon name="play" size={15}/> {direct ? 'Executar no host' : (needsApproval ? 'Aprovar e executar' : 'Executar')}</button>}
          {canReject && <button className="secondary-button" disabled={busy} onClick={() => void onRejectPendingChanges?.()}><Icon name="trash" size={14}/> {session.integration_conflict ? 'Cancelar conflito' : 'Rejeitar'}</button>}
          {canApply && <button className="apply-button" disabled={busy} onClick={onApply}><Icon name="apply" size={16}/> Aplicar no host{pendingCount > 1 ? ` (${pendingCount})` : ''}</button>}
        </div>
      </header>}

      {!embedded && <nav className="tabs" aria-label="Inspector">
        <button className={selectedTab === 'plan' ? 'active' : ''} onClick={() => selectTab('plan')}><Icon name="plan" size={16}/> Plano</button>
        <button className={selectedTab === 'terminal' ? 'active' : ''} onClick={() => selectTab('terminal')}><Icon name="terminal" size={16}/> Execução <span className="tab-count">{terminalEvents.length}</span></button>
        <button className={selectedTab === 'chatgpt' ? 'active' : ''} onClick={() => selectTab('chatgpt')}><Icon name="agent" size={16}/> Engine {desktop && <span className="desktop-dot" title="Wharnex Desktop"/>}</button>
        <button className={selectedTab === 'direct-chatgpt' ? 'active' : ''} onClick={() => selectTab('direct-chatgpt')}><Icon name="chatgpt" size={16}/> ChatGPT</button>
      </nav>}

      <div className={`inspector-content ${(selectedTab === 'chatgpt' || selectedTab === 'direct-chatgpt') && desktop ? 'desktop-content' : ''}`}>
        {selectedTab === 'plan' && <PlanView session={session} />}
        {selectedTab === 'terminal' && <TerminalView events={terminalEvents} />}
        {selectedTab === 'chatgpt' && (desktop
		  ? <ChatGPTDesktopPane suspended={chatgptSuspended || selectedTab !== 'chatgpt'} busy={busy} chatId={chatgptSurface?.cacheKey || chat?.id || ''} chatTitle={chatgptSurface?.title || chat?.title || 'Chat'} chatgptUrl={chatgptSurface?.url || chat?.chatgptUrl} pendingRequestId={session.integration_conflict?.request_id || session.pending_manual_request_ids?.[0]} onChatGPTURL={onChatGPTURL} onActivity={onChatGPTActivity} onTransportFailure={onTransportFailure} onCancelPendingRequest={onCancelPendingRequest} onPlanFile={importPlanFile} onBundleFile={onBundleFile} />
          : <ChatGPTWebFallback config={config} session={session} manualPrompt={manualPrompt} manualJSON={manualJSON} setManualJSON={setManualJSON} busy={busy} copy={copy} onManualPlan={onManualPlan} />)}
        {selectedTab === 'direct-chatgpt' && (desktop ? <DirectChatGPTPane projectPath={session.project_path} suspended={chatgptSuspended || selectedTab !== 'direct-chatgpt'}/> : <div className="provider-card warning-card">O ChatGPT livre incorporado requer Wharnex Desktop.</div>)}
      </div>
    </section>
  )
}

function ChatGPTWebFallback({ config, session, manualPrompt, manualJSON, setManualJSON, busy, copy, onManualPlan }: {
  config?: AppConfig
  session: Session
  manualPrompt: string
  manualJSON: string
  setManualJSON: (value: string) => void
  busy: boolean
  copy: (text: string) => Promise<void>
  onManualPlan: (json: string) => Promise<void>
}) {
  const automatic = config?.planner === 'openai' && config.api_configured
  return <div className="chatgpt-view">
    <div className="section-heading"><div><span className="panel-kicker">Browser mode</span><h3>ChatGPT</h3></div><StatusPill tone={automatic ? 'success' : 'neutral'}>{automatic ? 'API automática' : 'Bridge web'}</StatusPill></div>
    <div className="provider-card warning-card"><Icon name="workspace" size={18}/><div><strong>ChatGPT incorporado requer Wharness Desktop</strong><span>O modo web continua disponível, mas navegadores comuns não permitem compor a sessão remota do ChatGPT com os controles desktop do Wharness. Inicie `services/desktop` para trabalhar com as duas superfícies na mesma janela.</span></div></div>
    {automatic && <div className="provider-card success-card"><Icon name="check" size={18}/><div><strong>Planner automático ativo</strong><span>Os pedidos do Agent continuam a ser processados pela Responses API mesmo no navegador.</span></div></div>}
    <div className="bridge-actions">
      <a className="text-button" href={api.bundleURL(session.id)}><Icon name="download" size={15}/> Contexto ZIP</a>
      <a className="text-button" href="https://chatgpt.com/" target="_blank" rel="noreferrer"><Icon name="external" size={15}/> Abrir ChatGPT</a>
    </div>
    <label className="field-label">Prompt preparado</label>
    <div className="code-box prompt-box"><button className="code-copy" disabled={!manualPrompt} onClick={() => void copy(manualPrompt)}><Icon name="copy" size={14}/> Copiar</button><pre>{manualPrompt || 'Envie uma mensagem no Agent para gerar o prompt.'}</pre></div>
    <label className="field-label" htmlFor="manual-json">Plano JSON recebido</label>
    <textarea id="manual-json" className="json-input" spellCheck={false} value={manualJSON} onChange={(e) => setManualJSON(e.target.value)} placeholder={'{\n  "protocol": "harness.execution/v1",\n  ...\n}'} />
    <button className="primary-button full" disabled={busy || !manualJSON.trim()} onClick={() => onManualPlan(manualJSON)}>Validar plano no Harness</button>
  </div>
}

export function PlanView({ session }: { session: Session }) {
	const integration = <IntegrationQueue session={session} />
	if (!session.plan) return <>{integration}<Empty title="Nenhum plano ou passo local pendente" text="Perguntas podem ser respondidas sem plano. Quando uma mudança ou investigação local exigir execução, o passo validado aparecerá aqui." /></>
  const plan = session.plan
  const workflow = session.last_turn?.kind === 'workflow'
  const operations = plan.operations || []
  const verification = plan.verification || []
  const policyStatus = session.policy ? (session.policy.allowed ? (workflow ? 'Probe autorizada' : 'Policy OK') : 'Bloqueado') : 'Histórico'
  const policyTone = session.policy ? (session.policy.allowed ? 'success' : 'danger') : 'neutral'
	return <div className="plan-view">
	{integration}
    <div className="section-heading plan-heading"><div><span className="panel-kicker">{workflow ? `Workflow local ${session.workflow_round || 0}/6 · sandbox` : plan.protocol}</span><MarkdownContent markdown={plan.summary} compact /></div><StatusPill tone={policyTone}>{policyStatus}</StatusPill></div>
    {session.policy?.reasons?.length ? <div className="policy-box"><Icon name="shield" size={17}/><div><strong>Policy decision</strong>{session.policy.reasons.map((r) => <span key={r}>{r}</span>)}</div></div> : null}
    <div className="metric-row"><Metric label={workflow ? 'Comandos locais' : 'Operações'} value={String(operations.length)}/><Metric label="Verificações" value={String(verification.length)}/><Metric label="Risco" value={riskLabel(session.policy?.risk || plan.risk)}/></div>
    {session.last_bundle && <details className="bundle-readme"><summary>Resultado: {session.last_bundle.filename} · {session.last_bundle.patches?.length || 0} patch(es) · {session.last_bundle.files?.length || 0} ficheiro(s)</summary><div className="bundle-readme-body"><MarkdownContent markdown={session.last_bundle.readme} /></div></details>}
    <div className="operation-list">
      {operations.map((op, index) => <div className="operation" key={`${op.type}-${index}`}><div className="operation-index">{String(index + 1).padStart(2, '0')}</div><div className="operation-body"><strong>{op.type === 'apply_patch' ? 'Aplicar patch' : (op.command.argv || []).join(' ')}</strong><span>{op.type === 'apply_patch' ? patchFiles(op.patch || '') : `${op.command.cwd || '.'} · ${op.command.timeout_seconds}s${op.command.network ? ' · network' : ''}`}</span>{op.type === 'apply_patch' && <details><summary>Ver diff</summary><pre className="diff-view">{op.patch}</pre></details>}</div></div>)}
      {verification.map((command, index) => <div className="operation verification" key={`v-${index}`}><div className="operation-index"><Icon name="check" size={15}/></div><div className="operation-body"><strong>{(command.argv || []).join(' ')}</strong><span>Verification · {command.cwd || '.'}</span></div></div>)}
    </div>
  </div>
}

function IntegrationQueue({ session }: { session: Session }) {
	const pending = session.pending_host_changes || []
	if (!pending.length && !session.integration_conflict) return null
	return <section className="integration-queue" aria-label="Fila de integração">
		<div className="section-heading"><div><span className="panel-kicker">Concorrência</span><h3>Fila de integração</h3></div><StatusPill tone={session.integration_conflict ? 'danger' : 'success'}>{session.integration_conflict ? 'Conflito' : `${pending.length} verificado(s)`}</StatusPill></div>
		{pending.map((change) => <div className="operation" key={change.plan.plan_id}><div className="operation-index"><Icon name="apply" size={14}/></div><div className="operation-body"><strong>{change.plan.summary}</strong><span>{change.change_set ? `${change.change_set.state} · ${change.change_set.mutations.map((mutation) => mutation.path).join(', ')}` : 'Compatibilidade v1 · patch pendente'}</span></div></div>)}
		{session.integration_conflict && <div className="policy-box"><Icon name="chatgpt" size={17}/><div><strong>Janela GPT dedicada</strong><span>{session.integration_conflict.paths.join(', ')}</span><span>Pedido {session.integration_conflict.request_id}</span></div></div>}
	</section>
}

export function TerminalView({ events }: { events: HarnessEvent[] }) {
  const entries = useMemo(() => buildExecutionTimeline(events), [events])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const expandable = entries.filter((entry) => (entry.kind === 'command' || entry.kind === 'patch') && entry.output).slice(-5)
    setExpanded(new Set(expandable.map((entry) => entry.id)))
    endRef.current?.scrollIntoView?.({ block: 'end' })
    // This component mounts only while the Execução tab is active; the first
    // render intentionally expands only the five most recent output-bearing commands.
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [events.length])

  if (!events.length) return <Empty title="Execução limpa" text="Operações, verificações, aplicação no host, stdout e stderr aparecerão aqui em tempo real. O terminal interativo continua no modo Editor." />
  const active = entries.some((entry) => entry.running)
  const failed = [...entries].reverse().find((entry) => entry.tone === 'fail')
  return <div className="execution-view">
    <div className="execution-overview">
      <div><span className="panel-kicker">Execução observável</span><h3>{active ? 'Operação em curso' : failed ? 'Execução com falha' : 'Atividade de execução'}</h3><p>Cada comando é um único item: stdout/stderr ficam agrupados, com data/hora, duração e expansão sob demanda. A vista acompanha o fim enquanto esta aba estiver ativa.</p></div>
      <StatusPill tone={failed ? 'danger' : active ? 'warning' : 'success'}>{active ? 'LIVE' : failed ? 'Falhou' : 'Atualizada'}</StatusPill>
    </div>
    <div className="execution-timeline">
      {entries.map((entry, index) => {
        const canExpand = Boolean(entry.output)
        const isExpanded = expanded.has(entry.id)
		const previous = index > 0 ? entries[index - 1] : undefined
		const showGroup = !previous || previous.rootRequestId !== entry.rootRequestId || previous.iterationKind !== entry.iterationKind
        return <Fragment key={entry.id}>{showGroup && <div className={`execution-group-header kind-${entry.iterationKind}`}><strong>{executionKindLabel(entry.iterationKind)}</strong><a href={`#request-${entry.rootRequestId}`} title={entry.rootRequestId}>{entry.rootRequestId ? entry.rootRequestId.replace(/^req_/, '').slice(0, 22) : 'atividade da sessão'}</a></div>}<div className={`execution-command-card ${entry.running ? 'running' : ''}`}>
          <div className="execution-event">
            <span className={`lamp ${entry.tone === 'fail' ? 'fail' : entry.tone === 'warning' ? 'warning' : ''} ${entry.running ? 'blinking' : ''}`} />
            <div className="execution-event-copy"><strong>{entry.title}</strong><span>{formatExecutionDate(entry.timestamp)}{entry.detail ? ` · ${entry.detail}` : ''}{entry.durationMs !== undefined ? ` · ${formatDuration(entry.durationMs)}` : ''}</span></div>
            <div className="execution-event-actions"><code>{entry.badge}</code>{canExpand && <button type="button" className={isExpanded ? 'execution-expand open' : 'execution-expand'} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next })} title={isExpanded ? 'Ocultar output' : 'Mostrar output'} aria-label={isExpanded ? 'Ocultar output' : 'Mostrar output'}>⌄</button>}</div>
          </div>
          {canExpand && isExpanded && <pre className="execution-command-output">{entry.output}</pre>}
        </div></Fragment>
      })}
      <div ref={endRef}/>
    </div>
  </div>
}

function executionKindLabel(kind: 'standard' | 'repair' | 'evidence' | 'conflict') {
	return kind === 'repair' ? 'Resolução de erro' : kind === 'evidence' ? 'Extração de informações' : kind === 'conflict' ? 'Resolução de conflito' : 'Execução principal'
}

function formatExecutionDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
}

function formatDuration(value: number) {
  if (value < 1000) return `${value} ms`
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`
  const minutes = Math.floor(value / 60_000)
  return `${minutes}m ${Math.round((value % 60_000) / 1000)}s`
}

function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><div className="empty-mark">K/</div><h3>{title}</h3><p>{text}</p></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }
function patchFiles(patch: string) { const files = [...patch.matchAll(/^\+\+\+\s+b\/(.+)$/gm)].map((m) => m[1]); return files.length ? files.join(', ') : 'unified diff' }
