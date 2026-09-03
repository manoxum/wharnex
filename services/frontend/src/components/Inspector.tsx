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

export function Inspector({ config, session, events, manualPrompt, busy, chat, chatgptSuspended = false, onChatGPTURL, onContextSent, onExecute, onApply, onManualPlan, onPlanFile, onBundleFile, onSession }: {
  config?: AppConfig
  session: Session
  events: HarnessEvent[]
  manualPrompt: string
  busy: boolean
  chat?: WorkspaceChat
  chatgptSuspended?: boolean
  onChatGPTURL: (url: string) => void
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
  const terminalEvents = useMemo(() => events.filter((e) => ['command.completed', 'execution.failed', 'verification.baseline_unchanged', 'automation.policy_blocked', 'repair.started', 'repair.prompt_ready', 'repair.prepare_failed', 'workflow.started', 'workflow.completed', 'workflow.step_failed', 'workflow.policy_blocked', 'workflow.continuation_started', 'workflow.prompt_ready'].includes(e.type)), [events])
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
          ? <ChatGPTDesktopPane suspended={chatgptSuspended} session={session} manualPrompt={manualPrompt} busy={busy} chatId={chat?.id || ''} chatTitle={chat?.title || 'Chat'} chatgptUrl={chat?.chatgptUrl} onChatGPTURL={onChatGPTURL} onContextSent={onContextSent} onSession={onSession} onManualPlan={onManualPlan} onPlanFile={importPlanFile} onBundleFile={onBundleFile} />
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
    <label className="field-label" htmlFor="manual-json">Plano JSON recebido (fallback web)</label>
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
  if (!events.length) return <Empty title="Execução limpa" text="Comandos de mudanças e passos de investigação local, stdout, stderr, bloqueios de Policy e reparações automáticas aparecerão aqui. O terminal interativo está no modo Editor." />
  return <div className="terminal-view">{events.map((event) => {
    const baseline = event.type === 'verification.baseline_unchanged'
    const policyBlocked = event.type === 'automation.policy_blocked' || event.type === 'workflow.policy_blocked'
    const repair = event.type.startsWith('repair.')
    const workflow = event.type.startsWith('workflow.')
    const title = Array.isArray(event.data.argv)
      ? (event.data.argv as string[]).join(' ')
      : policyBlocked ? (workflow ? 'Policy bloqueou o passo local' : 'Policy bloqueou o plano antes da execução')
        : event.type === 'repair.started' ? 'Preparando correção automática'
          : event.type === 'repair.prompt_ready' ? 'Prompt de correção pronto'
            : event.type === 'workflow.started' ? 'Iniciando investigação local'
              : event.type === 'workflow.completed' ? 'Passo local concluído'
                : event.type === 'workflow.step_failed' ? 'Passo local produziu falha/diagnóstico'
                  : event.type === 'workflow.continuation_started' ? 'Preparando continuação com evidências'
                    : event.type === 'workflow.prompt_ready' ? 'Continuação pronta para o ChatGPT'
                      : event.type
    const reasons = Array.isArray(event.data.reasons) ? (event.data.reasons as unknown[]).map(String) : []
    return <div className="terminal-event" key={event.id}><div className="terminal-line"><span className={event.type === 'execution.failed' || policyBlocked || event.type === 'repair.prepare_failed' ? 'lamp fail' : (baseline || repair || event.type === 'workflow.step_failed' ? 'lamp warning' : 'lamp')} /> <code>{title}</code><span className="exit-code">{policyBlocked ? 'não executado' : baseline ? 'baseline unchanged' : repair ? `attempt ${String(event.data.attempt || '')}` : workflow ? (event.data.round ? `round ${String(event.data.round)}/6` : 'sandbox') : (event.data.exit_code !== undefined ? `exit ${String(event.data.exit_code)}` : '')}</span></div>{reasons.map((reason) => <pre className="stderr" key={reason}>{reason}</pre>)}{event.data.stdout ? <pre>{String(event.data.stdout)}</pre> : null}{event.data.stderr ? <pre className="stderr">{String(event.data.stderr)}</pre> : null}{event.data.diagnostic ? <pre className="warning-output">{String(event.data.diagnostic)}</pre> : null}{event.data.error ? <pre className="stderr">{String(event.data.error)}</pre> : null}</div>
  })}</div>
}

function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><div className="empty-mark">K/</div><h3>{title}</h3><p>{text}</p></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }
function patchFiles(patch: string) { const files = [...patch.matchAll(/^\+\+\+\s+b\/(.+)$/gm)].map((m) => m[1]); return files.length ? files.join(', ') : 'unified diff' }
