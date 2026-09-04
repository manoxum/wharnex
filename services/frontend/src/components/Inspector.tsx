import { useEffect, useMemo, useState } from 'react'
import type { AppConfig, HarnessEvent, Session } from '../types'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { riskLabel } from '../lib/risk'
import { api } from '../lib/api'
import { isDesktop } from '../lib/desktop'
import { ChatGPTDesktopPane } from './ChatGPTDesktopPane'
import { MarkdownContent } from './MarkdownContent'
import type { WorkspaceChat } from '../lib/workspaceMemory'

type Tab = 'plan' | 'terminal' | 'chatgpt'

export function Inspector({ config, session, events, manualPrompt, busy, chat, chatgptSuspended = false, onChatGPTURL, onExecute, onApply, onManualPlan, onPlanFile, onBundleFile }: {
  config?: AppConfig
  session: Session
  events: HarnessEvent[]
  manualPrompt: string
  busy: boolean
  chat?: WorkspaceChat
  chatgptSuspended?: boolean
  onChatGPTURL: (url: string) => boolean
  onContextSent?: (sha256: string, conversationUrl?: string) => void
  onExecute: (approved: boolean) => Promise<void>
  onApply: () => Promise<void>
  onManualPlan: (json: string) => Promise<void>
  onPlanFile: (json: string, requestId: string) => Promise<string>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
  onSession: (session: Session) => void
}) {
  const [tab, setTab] = useState<Tab>(config?.planner === 'manual' ? 'chatgpt' : 'plan')
  const [manualJSON, setManualJSON] = useState('')
  useEffect(() => { setManualJSON('') }, [chat?.id])
  const terminalEvents = useMemo(() => events.filter((e) => ['execution.started', 'execution.completed', 'execution.failed', 'automation.execution_failed', 'command.started', 'command.output', 'command.completed', 'patch.started', 'patch.applied', 'verification.started', 'verification.completed', 'verification.baseline_unchanged', 'verification.baseline_changed', 'automation.policy_blocked', 'repair.started', 'repair.prompt_ready', 'repair.prepare_failed', 'workflow.started', 'workflow.completed', 'workflow.step_failed', 'workflow.policy_blocked', 'workflow.continuation_started', 'workflow.prompt_ready'].includes(e.type)), [events])
  const canExecute = Boolean(session.plan && session.policy?.allowed && session.last_turn?.kind !== 'workflow')
  const needsApproval = Boolean(session.policy?.requires_approval)
  const direct = session.execution_mode === 'unprotected'
  const canApply = Boolean(!direct && session.last_execution?.success && session.state === 'verified' && session.last_turn?.kind !== 'workflow')
  const desktop = isDesktop()

  async function copy(text: string) { await navigator.clipboard.writeText(text) }
  async function importPlanFile(json: string, requestId: string) {
    const message = await onPlanFile(json, requestId)
    setTab('plan')
    return message
  }
  return (
    <section className="inspector-panel">
      <header className="panel-header inspector-header">
        <div className="brand-lockup small"><div className="brand-mark">K</div><div><strong>Agent Inspector</strong><span>{config?.planner || 'planner'} · {config?.sandbox || 'sandbox'}{desktop ? ' · desktop' : ''}</span></div></div>
        <div className="header-actions">
          {session.policy && <StatusPill tone={session.policy.allowed ? (session.policy.risk === 'high' ? 'warning' : 'accent') : 'danger'}>{riskLabel(session.policy.risk)}</StatusPill>}
          {direct && <StatusPill tone="warning">Unprotected</StatusPill>}
          {session.automation_mode === 'auto' && <StatusPill tone="success">Auto</StatusPill>}
          {canExecute && <button className={direct ? 'danger-button' : 'secondary-button'} disabled={busy} onClick={() => onExecute(needsApproval || direct)}><Icon name="play" size={15}/> {direct ? 'Executar no host' : (needsApproval ? 'Aprovar e executar' : 'Executar')}</button>}
          {canApply && <button className="apply-button" disabled={busy} onClick={onApply}><Icon name="apply" size={16}/> Aplicar no host</button>}
        </div>
      </header>

      <nav className="tabs" aria-label="Inspector">
        <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}><Icon name="plan" size={16}/> Plano</button>
        <button className={tab === 'terminal' ? 'active' : ''} onClick={() => setTab('terminal')}><Icon name="terminal" size={16}/> Execução <span className="tab-count">{terminalEvents.length}</span></button>
        <button className={tab === 'chatgpt' ? 'active' : ''} onClick={() => setTab('chatgpt')}><Icon name="chatgpt" size={16}/> ChatGPT {desktop && <span className="desktop-dot" title="Wharness Desktop"/>}</button>
      </nav>

      <div className={`inspector-content ${tab === 'chatgpt' && desktop ? 'desktop-content' : ''}`}>
        {tab === 'plan' && <PlanView session={session} />}
        {tab === 'terminal' && <TerminalView events={terminalEvents} />}
        {tab === 'chatgpt' && (desktop
          ? <ChatGPTDesktopPane suspended={chatgptSuspended} busy={busy} chatId={chat?.id || ''} chatTitle={chat?.title || 'Chat'} chatgptUrl={chat?.chatgptUrl} onChatGPTURL={onChatGPTURL} onPlanFile={importPlanFile} onBundleFile={onBundleFile} />
          : <ChatGPTWebFallback config={config} session={session} manualPrompt={manualPrompt} manualJSON={manualJSON} setManualJSON={setManualJSON} busy={busy} copy={copy} onManualPlan={onManualPlan} />)}
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

function PlanView({ session }: { session: Session }) {
  if (!session.plan) return <Empty title="Nenhum plano ou passo local pendente" text="Perguntas podem ser respondidas sem plano. Quando uma mudança ou investigação local exigir execução, o passo validado aparecerá aqui." />
  const plan = session.plan
  const workflow = session.last_turn?.kind === 'workflow'
  const operations = plan.operations || []
  const verification = plan.verification || []
  return <div className="plan-view">
    <div className="section-heading plan-heading"><div><span className="panel-kicker">{workflow ? `Workflow local ${session.workflow_round || 0}/6 · sandbox` : plan.protocol}</span><MarkdownContent markdown={plan.summary} compact /></div><StatusPill tone={session.policy?.allowed ? 'success' : 'danger'}>{session.policy?.allowed ? (workflow ? 'Probe autorizada' : 'Policy OK') : 'Bloqueado'}</StatusPill></div>
    {session.policy?.reasons?.length ? <div className="policy-box"><Icon name="shield" size={17}/><div><strong>Policy decision</strong>{session.policy.reasons.map((r) => <span key={r}>{r}</span>)}</div></div> : null}
    <div className="metric-row"><Metric label={workflow ? 'Comandos locais' : 'Operações'} value={String(operations.length)}/><Metric label="Verificações" value={String(verification.length)}/><Metric label="Risco" value={riskLabel(session.policy?.risk || plan.risk)}/></div>
    {session.last_bundle && <details className="bundle-readme"><summary>Resultado: {session.last_bundle.filename} · {session.last_bundle.patches?.length || 0} patch(es) · {session.last_bundle.files?.length || 0} ficheiro(s)</summary><div className="bundle-readme-body"><MarkdownContent markdown={session.last_bundle.readme} /></div></details>}
    <div className="operation-list">
      {operations.map((op, index) => <div className="operation" key={`${op.type}-${index}`}><div className="operation-index">{String(index + 1).padStart(2, '0')}</div><div className="operation-body"><strong>{op.type === 'apply_patch' ? 'Aplicar patch' : (op.command.argv || []).join(' ')}</strong><span>{op.type === 'apply_patch' ? patchFiles(op.patch || '') : `${op.command.cwd || '.'} · ${op.command.timeout_seconds}s${op.command.network ? ' · network' : ''}`}</span>{op.type === 'apply_patch' && <details><summary>Ver diff</summary><pre className="diff-view">{op.patch}</pre></details>}</div></div>)}
      {verification.map((command, index) => <div className="operation verification" key={`v-${index}`}><div className="operation-index"><Icon name="check" size={15}/></div><div className="operation-body"><strong>{(command.argv || []).join(' ')}</strong><span>Verification · {command.cwd || '.'}</span></div></div>)}
    </div>
  </div>
}

function TerminalView({ events }: { events: HarnessEvent[] }) {
  if (!events.length) return <Empty title="Execução limpa" text="O estado das operações, verificações, stdout, stderr, bloqueios de Policy e reparações automáticas aparecerá aqui em tempo real. O terminal interativo continua no modo Editor." />
  const streamedRunIDs = new Set(events.filter((event) => event.type === 'command.output').map((event) => String(event.data.run_id || '')).filter(Boolean))
  const logs = events.flatMap((event) => eventLogEntries(event, streamedRunIDs))
  const timelineEvents = events.filter((event) => event.type !== 'command.output')
  const running = [...timelineEvents].reverse().find((event) => event.type.endsWith('.started') || event.type === 'command.started')
  const completed = [...timelineEvents].reverse().find((event) => event.type === 'execution.completed' || event.type === 'execution.failed' || event.type === 'automation.execution_failed')
  return <div className="execution-view">
    <div className="execution-overview">
      <div><span className="panel-kicker">Execução observável</span><h3>{completed?.type === 'execution.completed' ? 'Execução concluída' : running ? 'Operação em curso' : 'Atividade de execução'}</h3><p>Os eventos SSE aparecem nesta linha temporal assim que são emitidos. A consola no final agrega as saídas sem criar scrolls verticais dentro de cada operação.</p></div>
      <StatusPill tone={completed?.type === 'execution.failed' || completed?.type === 'automation.execution_failed' ? 'danger' : running ? 'warning' : 'success'}>{running ? 'LIVE' : completed?.type === 'execution.completed' ? 'Concluída' : 'Atualizada'}</StatusPill>
    </div>
    <div className="execution-timeline">
      {timelineEvents.map((event) => {
        const meta = executionEventMeta(event)
        return <div className="execution-event" key={event.id}>
          <span className={meta.tone === 'fail' ? 'lamp fail' : meta.tone === 'warning' ? 'lamp warning' : 'lamp'} />
          <div className="execution-event-copy"><strong>{meta.title}</strong><span>{formatEventTime(event.timestamp)}{meta.detail ? ` · ${meta.detail}` : ''}</span></div>
          {meta.badge && <code>{meta.badge}</code>}
        </div>
      })}
    </div>
    <section className="execution-log-panel" aria-label="Logs de execução em tempo real">
      <div className="execution-log-heading"><div><span className="panel-kicker">Logs em tempo real</span><strong>Saída das operações</strong></div><span>{logs.length} entrada(s)</span></div>
      <div className="execution-log-stream">
        {logs.length ? logs.map((entry) => <div className={`execution-log-line ${entry.kind}`} key={entry.id}><time>{entry.time}</time><span>{entry.label}</span><pre>{entry.text}</pre></div>) : <div className="execution-log-empty">As operações em curso aparecem acima; stdout/stderr surgem aqui assim que cada comando produz um resultado.</div>}
      </div>
    </section>
  </div>
}

function executionEventMeta(event: HarnessEvent) {
  const argv = Array.isArray(event.data.argv) ? (event.data.argv as string[]).join(' ') : ''
  const exit = event.data.exit_code !== undefined ? `exit ${String(event.data.exit_code)}` : ''
  const target = typeof event.data.target === 'string' ? event.data.target : ''
  switch (event.type) {
    case 'execution.started': return { title: 'Execução iniciada', detail: target || String(event.data.execution_mode || ''), badge: 'RUN', tone: 'ok' }
    case 'execution.completed': return { title: 'Execução concluída', detail: target, badge: 'OK', tone: 'ok' }
    case 'execution.failed':
    case 'automation.execution_failed': return { title: 'Execução falhou', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' }
    case 'command.started': return { title: argv || 'Comando iniciado', detail: [String(event.data.cwd || '.'), target].filter(Boolean).join(' · '), badge: 'RUN', tone: 'warning' }
    case 'command.completed': return { title: argv || 'Comando concluído', detail: target, badge: exit, tone: event.data.success === false ? 'fail' : 'ok' }
    case 'patch.started': return { title: 'Aplicando patch', detail: target, badge: 'RUN', tone: 'warning' }
    case 'patch.applied': return { title: 'Patch aplicado', detail: target, badge: 'OK', tone: 'ok' }
    case 'verification.started': return { title: argv || 'Verificação iniciada', detail: target, badge: 'CHECK', tone: 'warning' }
    case 'verification.completed': return { title: 'Verificação concluída', detail: target, badge: exit, tone: event.data.baseline_failure ? 'warning' : 'ok' }
    case 'verification.baseline_unchanged': return { title: argv || 'Falha pré-existente inalterada', detail: 'baseline unchanged', badge: exit, tone: 'warning' }
    case 'verification.baseline_changed': return { title: argv || 'Baseline alterada', detail: 'verification drift', badge: 'WARN', tone: 'warning' }
    case 'automation.policy_blocked':
    case 'workflow.policy_blocked': return { title: 'Policy bloqueou a execução', detail: '', badge: 'BLOCK', tone: 'fail' }
    case 'repair.started': return { title: 'Correção automática iniciada', detail: '', badge: `#${String(event.data.attempt || '')}`, tone: 'warning' }
    case 'repair.prompt_ready': return { title: 'Prompt de correção pronto', detail: '', badge: 'READY', tone: 'warning' }
    case 'repair.prepare_failed': return { title: 'Falha ao preparar correção', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' }
    case 'workflow.started': return { title: 'Investigação local iniciada', detail: '', badge: event.data.round ? `${String(event.data.round)}/6` : 'RUN', tone: 'warning' }
    case 'workflow.completed': return { title: 'Passo local concluído', detail: '', badge: 'OK', tone: 'ok' }
    case 'workflow.step_failed': return { title: 'Passo local produziu diagnóstico', detail: '', badge: 'WARN', tone: 'warning' }
    case 'workflow.continuation_started': return { title: 'Continuação com evidências iniciada', detail: '', badge: event.data.round ? `${String(event.data.round)}/6` : 'RUN', tone: 'warning' }
    case 'workflow.prompt_ready': return { title: 'Continuação pronta para o ChatGPT', detail: '', badge: 'READY', tone: 'ok' }
    default: return { title: event.type, detail: '', badge: '', tone: 'ok' }
  }
}

function eventLogEntries(event: HarnessEvent, streamedRunIDs: Set<string>) {
  const time = formatEventTime(event.timestamp)
  if (event.type === 'command.output') {
    const text = typeof event.data.text === 'string' ? event.data.text : ''
    const stream = event.data.stream === 'stderr' ? 'stderr' : 'stdout'
    return text ? [{ id: `${event.id}-stream`, time, label: stream, kind: stream, text }] : []
  }
  const streamed = event.type === 'command.completed' && streamedRunIDs.has(String(event.data.run_id || ''))
  const values: Array<{ key: string; label: string; kind: string }> = [
    ...(!streamed ? [{ key: 'stdout', label: 'stdout', kind: 'stdout' }, { key: 'stderr', label: 'stderr', kind: 'stderr' }] : []),
    { key: 'diagnostic', label: 'diagnóstico', kind: 'warning' }, { key: 'baseline_diagnostic', label: 'baseline', kind: 'warning' },
    { key: 'post_diagnostic', label: 'pós-verificação', kind: 'warning' }, { key: 'error', label: 'erro', kind: 'stderr' },
  ]
  const entries = values.flatMap(({ key, label, kind }) => {
    const text = typeof event.data[key] === 'string' ? String(event.data[key]).trim() : ''
    return text ? [{ id: `${event.id}-${key}`, time, label, kind, text }] : []
  })
  const reasons = Array.isArray(event.data.reasons) ? (event.data.reasons as unknown[]).map(String).filter(Boolean) : []
  return [...entries, ...reasons.map((text, index) => ({ id: `${event.id}-reason-${index}`, time, label: 'policy', kind: 'stderr', text }))]
}

function formatEventTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
}

function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><div className="empty-mark">K/</div><h3>{title}</h3><p>{text}</p></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }
function patchFiles(patch: string) { const files = [...patch.matchAll(/^\+\+\+\s+b\/(.+)$/gm)].map((m) => m[1]); return files.length ? files.join(', ') : 'unified diff' }
