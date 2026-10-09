import { InspectorTabs } from './InspectorTabs'
import { useEffect, useMemo, useState } from 'react'
import type { AppConfig, ChatChangeFile, ChatGPTActivity, HarnessEvent, Operation, Session } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { StatusPill } from '../../presentation/chrome/StatusPill'
import { riskLabel } from '../../../lib/execution/recovery/risk'
import { api } from '../../../lib/transport/http/api'
import { isDesktop } from '../../../lib/desktop/bridge/desktop'
import { ChatGPTDesktopPane } from '../../chatgpt/surface/ChatGPTDesktopPane'
import { DirectChatGPTPane } from '../../chatgpt/surface/DirectChatGPTPane'
import { MarkdownContent } from '../../presentation/content/MarkdownContent'
import { TranslatableMarkdown } from '../../presentation/content/TranslatableMarkdown'
import { ConflictResolverModal } from './ConflictResolverModal'
import { ExecutionPlanAdjustment } from './ExecutionPlanAdjustment'
import type { WorkspaceChat } from '../../../lib/chat/history/workspaceMemory'
import { sessionHostResolutionBlocked } from '../../../lib/attention/center/attentionCenter'
import { activePendingRequestId } from '../../../lib/agent/runtime/pendingRequest'
import { sessionCanExecutePlan, sessionNeedsExecutionConsent } from '../../../lib/execution/recovery/executionRecovery'
import { SignalCore } from '../../presentation/chrome/SignalCore'
import { ChatArtifactLibrary } from '../../artifacts/explorer/BundleExplorer'
import { ChangeDiffEditor } from '../canvas/ChangeDiffEditor'
import { shortPlanId } from '../../../lib/workspace/exports/activityFormat'
import { PlanHistorySurface } from '../../execution/history/PlanHistorySurface'
import { useExecutionHistory } from '../../execution/history/useExecutionHistory'
import { ExecutionHistorySurface } from '../../execution/history/ExecutionHistorySurface'
import { filterExecutionAuditEvents } from '../../../lib/execution/history/executionAudit'
import { mergeAuditEvents } from '../../../lib/project/context/projectActivity'
import { ExecutionConsentAction } from '../../execution/consent'
import { ExecutionApprovalPanel } from '../../execution/controls/ExecutionApprovalPanel'

export type InspectorTab = 'files' | 'plan' | 'terminal' | 'chatgpt' | 'direct-chatgpt'
export { TerminalView } from '../../execution/history/ExecutionHistorySurface'

export function Inspector({ config, session, events, manualPrompt, busy, chat, chats, chatgptSuspended = false, activeTab, onTabChange, embedded = false, onChatGPTURL, onChatGPTActivity, onTransportFailure, onCancelPendingRequest, onResendPendingRequest, onExecute, onApproveDebug, onAdjustExecutionPlan, onRejectExecutionPlan, onRejectPendingChanges, onControlExecutionPlan, onPrepareExecutionPlanReversal, onManualPlan, onPlanFile, onBundleFile, onSession, onResolveConflictWithGPT }: {
  config?: AppConfig
  session: Session
  events: HarnessEvent[]
  manualPrompt: string
  busy: boolean
  chat?: WorkspaceChat
  chats?: WorkspaceChat[]
  chatgptSuspended?: boolean
  activeTab?: InspectorTab
  onTabChange?: (tab: InspectorTab) => void
  embedded?: boolean
  onChatGPTURL: (url: string) => boolean
  onChatGPTActivity?: (activity: ChatGPTActivity) => void
	 onTransportFailure?: (requestId: string, reason: string) => void
  onCancelPendingRequest?: (requestId: string) => Promise<void>
  onResendPendingRequest?: (requestId: string) => Promise<void>
  onContextSent?: (sha256: string, conversationUrl?: string) => void
  onExecute: (approved: boolean, sudoPassword?: string) => Promise<void>
  onApproveDebug?: () => Promise<void>
  onAdjustExecutionPlan?: () => void
  onRetryDependencyNetwork?: () => Promise<void>
  onRetryHostDependencyRepair?: () => Promise<void>
  onRejectExecutionPlan?: () => Promise<void>
  onRejectPendingChanges?: () => Promise<void>
  onControlExecutionPlan?: (action: 'pause' | 'resume' | 'suspend') => Promise<void>
  onPrepareExecutionPlanReversal?: () => Promise<void>
  onManualPlan: (json: string) => Promise<void>
  onPlanFile: (json: string, requestId: string) => Promise<string>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
  onSession: (session: Session) => void
  onResolveConflictWithGPT?: (session: Session) => Promise<void>
}) {
  const [tab, setTab] = useState<InspectorTab>(config?.planner === 'manual' ? 'chatgpt' : 'plan')
  const selectedTab = activeTab ?? tab
  const selectTab = (next: InspectorTab) => { if (activeTab === undefined) setTab(next); onTabChange?.(next) }
  const [manualJSON, setManualJSON] = useState('')
  const [conflictResolverOpen, setConflictResolverOpen] = useState(false)
  const [conflictGuidance, setConflictGuidance] = useState('')
  const { events: durableHistory, loading: historyLoading, error: historyError } = useExecutionHistory(session, selectedTab)
  useEffect(() => { setManualJSON('') }, [chat?.id])
  const auditEvents = useMemo(() => mergeAuditEvents(durableHistory, events), [durableHistory, events])
  const terminalEvents = useMemo(() => filterExecutionAuditEvents(auditEvents), [auditEvents])
  const canExecute = sessionCanExecutePlan(session)
  const needsApproval = sessionNeedsExecutionConsent(session)
  const direct = session.execution_mode !== 'protected'
  const pendingCount = session.pending_host_changes?.length || 0
  const canReject = Boolean(!direct && pendingCount && (!sessionHostResolutionBlocked(session) || session.integration_conflict))
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
        <div className="brand-lockup small"><SignalCore size="compact" decorative /><div><strong>Agent Inspector</strong><span>{config?.planner || 'planner'} · {config?.sandbox || 'sandbox'}{desktop ? ' · desktop' : ''}</span></div></div>
        <div className="header-actions">
          {session.policy && <StatusPill tone={session.policy.allowed ? (session.policy.risk === 'high' ? 'warning' : 'accent') : 'danger'}>{riskLabel(session.policy.risk)}</StatusPill>}
          {direct && <StatusPill tone="warning">{session.execution_mode === 'full' ? 'Full' : 'Unprotected'}</StatusPill>}
          {session.automation_mode === 'auto' && <StatusPill tone="success">Auto</StatusPill>}
          {session.automation_mode === 'auto_approve' && <StatusPill tone="warning">Auto + Aprovar</StatusPill>}
          {session.chat_transport_mode === 'manual' && <StatusPill tone="warning">Manual · Engine</StatusPill>}
        </div>
      </header>}

      {!embedded && <InspectorTabs value={selectedTab} onChange={selectTab} executions={terminalEvents.length}/>}

      <div className={`inspector-content ${(selectedTab === 'chatgpt' || selectedTab === 'direct-chatgpt') && desktop ? 'desktop-content' : ''} ${selectedTab === 'files' ? 'files-content' : ''}`}>
        {selectedTab === 'files' && <ChatArtifactLibrary sessionId={session.id} artifacts={session.artifacts} requestLineages={session.request_lineages}/>}
        {selectedTab === 'plan' && <PlanHistorySurface session={session} chat={chat} events={auditEvents} loading={historyLoading} error={historyError} renderHistoricalPlan={(historySession) => <PlanView session={historySession} readOnly/>} currentPlan={<PlanView session={session} busy={busy} canExecute={canExecute} needsApproval={needsApproval} canRejectPending={canReject} onExecute={onExecute} onApproveDebug={onApproveDebug} onAdjustExecutionPlan={onAdjustExecutionPlan} onRejectExecutionPlan={onRejectExecutionPlan} onRejectPendingChanges={onRejectPendingChanges} onControlExecutionPlan={onControlExecutionPlan} onPrepareExecutionPlanReversal={onPrepareExecutionPlanReversal} conflictGuidance={conflictGuidance} onConflictGuidance={setConflictGuidance} onResolveManually={() => setConflictResolverOpen(true)} onResolveWithGPT={() => void (async () => { const updated = await api.delegateConflictToGPT(session.id, [], conflictGuidance); onSession(updated); await onResolveConflictWithGPT?.(updated) })()} />}/>}
        {selectedTab === 'terminal' && <ExecutionHistorySurface session={session} events={auditEvents} loading={historyLoading} error={historyError}/>}
        {selectedTab === 'chatgpt' && !desktop && <ChatGPTWebFallback config={config} session={session} manualPrompt={manualPrompt} manualJSON={manualJSON} setManualJSON={setManualJSON} busy={busy} copy={copy} onManualPlan={onManualPlan} />}
        {desktop && <ChatGPTEnginePool
          visible={selectedTab === 'chatgpt'}
          globallySuspended={chatgptSuspended}
          chats={chats && chats.length ? chats : (chat ? [chat] : [])}
          activeChatId={chat?.id || ''}
          busy={busy}
          session={session}
          manualPrompt={manualPrompt}
          onChatGPTURL={onChatGPTURL}
          onChatGPTActivity={onChatGPTActivity}
          onTransportFailure={onTransportFailure}
          onCancelPendingRequest={onCancelPendingRequest}
          onResendPendingRequest={onResendPendingRequest}
          onPlanFile={importPlanFile}
          onBundleFile={onBundleFile}
        />}
        {selectedTab === 'direct-chatgpt' && (desktop ? <DirectChatGPTPane projectPath={session.project_path} suspended={chatgptSuspended || selectedTab !== 'direct-chatgpt'}/> : <div className="provider-card warning-card">O ChatGPT livre incorporado requer Wharnex Desktop.</div>)}
      </div>
      {conflictResolverOpen && session.integration_conflict && <ConflictResolverModal session={session} busy={busy} onClose={() => setConflictResolverOpen(false)} onSession={onSession} onDelegateToGPT={async (updated) => { await onResolveConflictWithGPT?.(updated) }} />}
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
    <div className="provider-card warning-card"><Icon name="workspace" size={18}/><div><strong>ChatGPT incorporado requer Wharnex Desktop</strong><span>O modo web continua disponível, mas navegadores comuns não permitem compor a sessão remota do ChatGPT com os controles desktop do Wharnex. Inicie `services/desktop` para trabalhar com as duas superfícies na mesma janela.</span></div></div>
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

// The renderer exposes exactly one human-facing Supervisor pane. Background
// automation is owned by the Desktop process' three hidden worker browsers and
// the durable backend queue, so React must not keep a pane mounted per chat.
// Re-rendering the same component with another chat id preserves one Supervisor
// surface while Desktop coalesces navigation around submit/write critical phases.
function ChatGPTEnginePool({ visible, globallySuspended, chats, activeChatId, busy, session, manualPrompt, onChatGPTURL, onChatGPTActivity, onTransportFailure, onCancelPendingRequest, onResendPendingRequest, onPlanFile, onBundleFile }: {
  visible: boolean
  globallySuspended: boolean
  chats: WorkspaceChat[]
  activeChatId: string
  busy: boolean
  session: Session
  manualPrompt: string
  onChatGPTURL: (url: string) => boolean
  onChatGPTActivity?: (activity: ChatGPTActivity) => void
  onTransportFailure?: (requestId: string, reason: string) => void
  onCancelPendingRequest?: (requestId: string) => Promise<void>
  onResendPendingRequest?: (requestId: string) => Promise<void>
  onPlanFile: (json: string, requestId: string) => Promise<string>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
}) {
  const activeChat = chats.find((chat) => chat.id === activeChatId)
  // React commits the selected chat id before an uncached Session fetch can
  // finish. Never mount a remote surface using the previous chat's Session in
  // that interval: its pending request/conflict identity belongs elsewhere.
  if (!activeChat || activeChat.sessionId !== session.id) return <div className="desktop-chatgpt-pool" hidden />
  return <div className="desktop-chatgpt-pool" hidden={!visible}>
    <div className="desktop-chatgpt-pool-item active">
      <ChatGPTDesktopPane
        suspended={globallySuspended || !visible}
        busy={busy}
        chatId={activeChat.id}
        chatTitle={activeChat.title}
        chatgptUrl={activeChat.chatgptUrl}
        pendingRequestId={activePendingRequestId(session)}
        sessionId={session.id}
        chatHash={session.context.workspace_sha256 || session.context.manifest.sha256}
        requestedAt={session.request_lineages?.[activePendingRequestId(session)]?.created_at || session.created_at}
        recoveryBootstrap={session.last_manual_prompt}
        transportMode={session.chat_transport_mode || 'scraper'}
        manualPrompt={manualPrompt}
        onChatGPTURL={onChatGPTURL}
        onActivity={onChatGPTActivity}
        onTransportFailure={onTransportFailure}
        onCancelPendingRequest={onCancelPendingRequest}
        onResendPendingRequest={onResendPendingRequest}
        onPlanFile={onPlanFile}
        onBundleFile={onBundleFile}
      />
    </div>
  </div>
}

export function PlanView({ session, readOnly = false, busy = false, canExecute = false, needsApproval = false, canRejectPending = false, onExecute, onApproveDebug, onAdjustExecutionPlan, onRejectExecutionPlan, onRejectPendingChanges, onControlExecutionPlan, onPrepareExecutionPlanReversal, conflictGuidance = '', onConflictGuidance, onResolveManually, onResolveWithGPT }: {
  session: Session
  readOnly?: boolean
  busy?: boolean
  canExecute?: boolean
  needsApproval?: boolean
  canRejectPending?: boolean
  onExecute?: (approved: boolean, sudoPassword?: string) => Promise<void>
  onApproveDebug?: () => Promise<void>
  onAdjustExecutionPlan?: () => void
  onRejectExecutionPlan?: () => Promise<void>
  onRejectPendingChanges?: () => Promise<void>
  onControlExecutionPlan?: (action: 'pause' | 'resume' | 'suspend') => Promise<void>
  onPrepareExecutionPlanReversal?: () => Promise<void>
  conflictGuidance?: string
  onConflictGuidance?: (value: string) => void
  onResolveManually?: () => void
  onResolveWithGPT?: () => void
}) {
  const [manualNotice, setManualNotice] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  const [sudoPassword, setSudoPassword] = useState('')
  useEffect(() => { setManualNotice(''); setSudoPassword('') }, [session.plan?.plan_id])
	const integration = readOnly ? null : <IntegrationQueue session={session} conflictGuidance={conflictGuidance} onConflictGuidance={onConflictGuidance} onResolveManually={onResolveManually} onResolveWithGPT={onResolveWithGPT} />
	if (!session.plan) return <>{integration}<Empty title="Nenhum plano ou passo local pendente" text="Perguntas podem ser respondidas sem plano. Quando uma mudança ou investigação local exigir execução, o passo validado aparecerá aqui." /></>
  const plan = session.plan
  const workflow = session.last_turn?.kind === 'workflow'
  const operations = plan.operations || []
  const verification = plan.verification || []
  const dependencies = plan.dependencies || []
  const systemTools = plan.system_tools || []
  const patches = operations.filter((operation) => operation.type === 'apply_patch')
  const manualPatches = manualPatchEntries(plan.plan_id, patches)
  const hostTools = systemTools.filter((tool) => tool.target === 'host' && tool.action !== 'use')
  const approvalItems = session.policy?.approval_items || []
  const policyStatus = session.policy ? (session.policy.allowed ? (workflow ? 'Probe autorizada' : 'Policy OK') : 'Bloqueado') : 'Histórico'
  const pendingCount = session.pending_host_changes?.length || 0
  const planControl = session.plan_control?.plan_id === plan.plan_id ? session.plan_control.state : 'active'
  const hostApplied = Boolean(session.last_applied_changes?.some((change) => change.plan.plan_id === plan.plan_id))
  const canControlAutoApprovedPlan = !readOnly && session.automation_mode === 'auto_approve' && session.execution_mode === 'protected' && !workflow && plan.status === 'ready' && !hostApplied
  const canReverseAppliedPlan = !readOnly && session.execution_mode === 'protected' && hostApplied

  async function savePatchesToProject() {
    if (!manualPatches.length) return
    setManualBusy(true); setManualNotice('')
    try {
      const listed = await api.listFiles(session.id)
      if (!listed.files.some((entry) => entry.kind === 'directory' && entry.path.replace(/\/$/, '') === 'patches')) await api.createWorkspacePath(session.id, 'patches', 'directory')
      for (const patch of manualPatches) {
        let file
        try { file = await api.readFile(session.id, patch.path) }
        catch { await api.createWorkspacePath(session.id, patch.path, 'file'); file = await api.readFile(session.id, patch.path) }
        if (file.content !== patch.content) await api.writeFile(session.id, { path: patch.path, content: patch.content, sha256: file.sha256 })
      }
      setManualNotice(`${manualPatches.length} patch(es) guardado(s) em /patches.`)
    } catch (error) { setManualNotice(error instanceof Error ? error.message : String(error)) }
    finally { setManualBusy(false) }
  }

  async function copyManualCommands() {
    try { await navigator.clipboard.writeText(buildManualCommandBatch(manualPatches, operations, verification)); setManualNotice('Lote de comandos copiado para a área de transferência.') }
    catch (error) { setManualNotice(error instanceof Error ? error.message : 'Não foi possível copiar os comandos.') }
  }
  const policyTone = session.policy ? (session.policy.allowed ? 'success' : 'danger') : 'neutral'
	return <div className="plan-view">
	{integration}
    {!readOnly && <div className="plan-control-surface">
      <div className="plan-control-primary">
        <div className="plan-control-copy"><span className="plan-control-mark"><Icon name="plan" size={15}/></span><div><span className="panel-kicker">Contrato de execução</span><strong>{canExecute ? 'Aguardando a sua decisão' : pendingCount ? 'Integração pendente de recuperação' : 'Plano registado'}</strong><span>{session.execution_mode === 'full' ? 'Full executa diretamente no host e dispensa gates marcados como bypassáveis; sudo continua a exigir autorização explícita e senha efémera.' : session.execution_mode === 'unprotected' ? 'Unprotected executa diretamente no host após confirmação; não existe sandbox nem uma etapa posterior de Apply.' : needsApproval ? 'Uma aprovação cobre a execução Protected e a integração automática no host; correções só voltam a pedir decisão quando introduzem novo impacto.' : pendingCount ? 'A aplicação ao host já foi autorizada pelo plano. Não existe uma segunda aprovação de Apply; apenas a recuperação do bloqueio pendente.' : 'Depois de uma execução Protected autorizada e verificada, a integração no host acontece sem uma segunda aprovação.'}</span></div></div>
        <div className="plan-decision-actions">

          {busy && session.plan.debug?.protocol === 'harness.interactive/v2' && <button type="button" className="danger-button" onClick={() => void api.cancelInteractive(session.id).then(() => setManualNotice('Cancelamento da ronda Interactive v2 solicitado.')).catch((error) => setManualNotice(error instanceof Error ? error.message : String(error)))}><Icon name="close" size={13}/> Parar ronda</button>}
          {canControlAutoApprovedPlan && planControl === 'active' && <button type="button" className="secondary-button" onClick={() => void onControlExecutionPlan?.('pause')}><Icon name="pause" size={13}/> Pausar</button>}
          {canControlAutoApprovedPlan && planControl !== 'active' && <button type="button" className="apply-button" onClick={() => void onControlExecutionPlan?.('resume')}><Icon name="play" size={13}/> Retomar</button>}
          {canControlAutoApprovedPlan && planControl !== 'suspended' && <button type="button" className="secondary-button" onClick={() => void onControlExecutionPlan?.('suspend')}><Icon name="close" size={13}/> Suspender</button>}
          {canExecute && <><button type="button" className="secondary-button" disabled={busy} onClick={() => void onRejectExecutionPlan?.()}><Icon name="trash" size={13}/> Rejeitar</button><ExecutionPlanAdjustment session={session} busy={busy} onAdjust={onAdjustExecutionPlan} /></>}
          <ExecutionConsentAction key={`${session.id}:${plan.plan_id}`} canExecute={canExecute} session={session} busy={busy} sudoPassword={sudoPassword} onClearPassword={() => setSudoPassword('')} onExecute={onExecute} onApproveDebug={onApproveDebug}/>
          {canRejectPending && <button type="button" className="secondary-button" disabled={busy} onClick={() => void onRejectPendingChanges?.()}><Icon name="trash" size={13}/> Rejeitar</button>}
          {canReverseAppliedPlan && <button type="button" className="secondary-button" disabled={busy} onClick={() => void onPrepareExecutionPlanReversal?.()}><Icon name="history" size={13}/> Reverter com GPT</button>}
        </div>
      </div>
      <ExecutionApprovalPanel items={approvalItems} mode={session.execution_mode} busy={busy} sudoPassword={sudoPassword} onSudoPassword={setSudoPassword} />
      {canControlAutoApprovedPlan && <div className="plan-manual-tools"><div className="plan-manual-copy"><span className="plan-manual-mark"><Icon name="shield" size={13}/></span><div><span className="panel-kicker">Auto + Aprovar</span><strong>{planControl === 'active' ? 'Plano ativo antes do Apply' : planControl === 'paused' ? 'Plano pausado antes do Apply' : 'Plano suspenso antes do Apply'}</strong><small>O plano permanece legível e a integração no host respeita este controlo mesmo se a sandbox já estiver a executar.</small></div></div></div>}
      {manualPatches.length > 0 && <div className="plan-manual-tools"><div className="plan-manual-copy"><span className="plan-manual-mark"><Icon name="download" size={13}/></span><div><span className="panel-kicker">Fallback manual</span><strong>Aplicação alternativa dos patches</strong><small>Guarde uma cópia em /patches ou copie um lote com quoting seguro para executar manualmente na raiz do projeto.</small></div></div><div className="plan-manual-actions"><button type="button" className="secondary-button" disabled={manualBusy} onClick={() => void savePatchesToProject()}><Icon name="download" size={13}/> Descarregar patches</button><button type="button" className="secondary-button" disabled={manualBusy} onClick={() => void copyManualCommands()}><Icon name="copy" size={13}/> Copiar lote de comandos</button></div></div>}
    </div>}
    {!readOnly && manualNotice && <p className="plan-manual-notice" role="status">{manualNotice}</p>}
    <div className="section-heading plan-heading">
      <div className="plan-heading-copy">
        <span className="panel-kicker">{plan.debug ? `Debug ${plan.debug.target} · ${session.workflow_round || 0}/6` : workflow ? `Workflow local ${session.workflow_round || 0}/6 · sandbox` : plan.protocol}</span>
        <h3>{plan.summary}</h3>
        <div className="plan-heading-meta"><code title={plan.plan_id}>{shortPlanId(plan.plan_id)}</code><span>{operations.length} {operations.length === 1 ? 'operação' : 'operações'}</span><span>{verification.length} {verification.length === 1 ? 'verificação' : 'verificações'}</span></div>
      </div>
      <StatusPill tone={policyTone}>{policyStatus}</StatusPill>
    </div>
    {plan.debug && <div className="policy-box"><Icon name="terminal" size={17}/><div><strong>{plan.debug.protocol === 'harness.interactive/v2' ? `Interactive v2 · ${plan.debug.target} · ${plan.debug.access || 'observe'}` : plan.debug.target === 'host' && plan.debug.access === 'modify' ? 'Ação de debug no host' : `Probe de debug · ${plan.debug.target}`}</strong><span>{plan.debug.rationale}</span>{plan.debug.protocol === 'harness.interactive/v2' ? <><span>Capacidades: {(plan.debug.capabilities || []).join(', ') || 'nenhuma'}.</span><span>Escopo: {interactiveScopeSummary(plan.debug.scope)}</span><span>{plan.debug.access === 'modify' ? 'A autorização é one-shot e vinculada ao plano/digest; qualquer novo impacto exige nova decisão.' : 'A autorização fica limitada ao Main Request, target, capacidades e escopo apresentados.'}</span></> : <span>{plan.debug.target === 'host' && plan.debug.access === 'modify' ? 'Pode alterar o host somente após aprovação deste plano; patches continuam proibidos e rede/ferramentas seguem a Policy.' : 'Somente observação validada; sem patches, rede ou alterações no host.'}</span>}</div></div>}
    {session.policy?.reasons?.length ? <div className="policy-box"><Icon name="shield" size={17}/><div><strong>Policy decision</strong>{session.policy.reasons.map((r) => <span key={r}>{r}</span>)}</div></div> : null}
    <div className="metric-row plan-metrics"><Metric label="Operações" value={String(operations.length)}/><Metric label="Verificações" value={String(verification.length)}/><Metric label="Ficheiros previstos" value={String(plan.impact_files?.length || patches.length)}/><Metric label="Dependências" value={String(dependencies.length)}/><Metric label="Ferramentas SO" value={String(systemTools.length)}/><Metric label="Risco" value={riskLabel(session.policy?.risk || plan.risk)}/></div>
    {plan.approved_chat_plan && <section className="plan-document"><div className="plan-section-title"><span>00</span><div><strong>Plano do Chat aprovado</strong><small>Vínculo verificado · {plan.approved_chat_plan.sha256.slice(0, 12)}…</small></div></div><MarkdownContent markdown={plan.approved_chat_plan.document}/></section>}
    <section className="plan-document"><div className="plan-section-title"><span>01</span><div><strong>Plano de execução</strong><small>Contrato completo do que será executado e aplicado</small></div></div><MarkdownContent markdown={plan.document || '_Plano legado: o documento detalhado não fazia parte deste protocolo. Consulte o resumo e as operações abaixo._'}/></section>
    <section className="plan-impact-grid">
      <div className="plan-impact-panel"><div className="plan-section-title"><span>02</span><div><strong>Dependências do projeto</strong><small>{dependencies.length ? `${dependencies.length} alteração(ões) declarada(s)` : 'Nenhuma alteração declarada'}</small></div></div>{dependencies.length ? <div className="plan-requirement-list">{dependencies.map((dependency, index) => <div className="plan-requirement" key={`${dependency.scope}-${dependency.manager}-${dependency.name}-${index}`}><span className={`requirement-action action-${dependency.action}`}>{dependency.action}</span><div><strong>{dependency.name}{dependency.version ? ` · ${dependency.version}` : ''}</strong><small>{dependency.scope} · {dependency.manager}</small><p>{dependency.reason}</p></div></div>)}</div> : <p className="plan-none">O plano não instala nem atualiza dependências do projeto.</p>}</div>
      <div className={`plan-impact-panel${hostTools.length ? ' host-impact' : ''}`}><div className="plan-section-title"><span>03</span><div><strong>Ferramentas do sistema</strong><small>{hostTools.length ? 'Existe impacto no host' : `${systemTools.length} requisito(s) declarado(s)`}</small></div></div>{systemTools.length ? <div className="plan-requirement-list">{systemTools.map((tool, index) => <div className="plan-requirement" key={`${tool.target}-${tool.name}-${index}`}><span className={`requirement-target target-${tool.target}`}>{tool.target}</span><div><strong>{tool.name} · {tool.action}{tool.lifetime ? ` · ${tool.lifetime === 'temporary' ? 'temporária' : 'persistente'}` : ''}</strong><p>{tool.reason}</p></div></div>)}</div> : <p className="plan-none">Nenhuma ferramenta de SO será instalada ou configurada.</p>}</div>
    </section>
    {session.last_bundle && <details className="bundle-readme"><summary>Resultado: {session.last_bundle.filename} · {session.last_bundle.patches?.length || 0} patch(es) · {session.last_bundle.files?.length || 0} ficheiro(s)</summary><div className="bundle-readme-body"><TranslatableMarkdown sessionId={session.id} markdown={session.last_bundle.readme} /></div></details>}
    <div className="plan-section-title plan-changes-title"><span>04</span><div><strong>Alterações previstas</strong><small>Diffs exatos incluídos no bundle</small></div></div>
    <div className="operation-list">
      {operations.map((op, index) => <div className="operation" key={`${op.type}-${index}`}><div className="operation-index">{String(index + 1).padStart(2, '0')}</div><div className="operation-body"><strong>{interactiveOperationLabel(op)}</strong><span>{interactiveOperationDetail(op)}</span>{op.type === 'shell' && op.shell?.script && <pre className="plan-interactive-payload"><code>{op.shell.script}</code></pre>}{op.type === 'sql' && op.sql?.statement && <pre className="plan-interactive-payload"><code>{op.sql.statement}</code></pre>}{op.type === 'apply_patch' && <PlanPatchDiff sessionId={session.id} patch={op.patch || ''}/>}</div></div>)}
      {verification.map((command, index) => <div className="operation verification" key={`v-${index}`}><div className="operation-index"><Icon name="check" size={15}/></div><div className="operation-body"><strong>{(command.argv || []).join(' ')}</strong><span>Verification · {command.cwd || '.'}</span></div></div>)}
    </div>
  </div>
}


function interactiveScopeSummary(scope?: NonNullable<import('../../../types').ExecutionPlan['debug']>['scope']) {
  if (!scope) return 'nenhum escopo declarado'
  const groups = [
    ['paths', scope.paths], ['db', scope.connections], ['logs', scope.log_sources], ['processes', scope.processes],
    ['services', scope.services], ['containers', scope.containers], ['network', scope.network_destinations],
  ] as const
  const parts = groups.filter(([, values]) => values?.length).map(([name, values]) => `${name}=${values!.join(',')}`)
  return parts.length ? parts.join(' · ') : 'nenhum escopo declarado'
}

function interactiveOperationLabel(op: Operation) {
  if (op.type === 'apply_patch') return 'Aplicar patch'
  if (op.type === 'command') return (op.command?.argv || []).join(' ') || 'Comando'
  if (op.type === 'shell') return `${op.shell?.shell || 'shell'} · script exato`
  if (op.type === 'sql') return `SQL · ${op.sql?.connection_id || 'conexão'} · ${op.sql?.mode || ''}`
  if (op.type === 'logs') return `Logs · ${op.logs?.source || 'fonte'}`
  if (op.type === 'filesystem') return `Filesystem · ${op.filesystem?.action || ''} ${op.filesystem?.path || ''}`
  if (op.type === 'process') return `Processo · ${op.process?.action || ''}${op.process?.pid ? ` ${op.process.pid}` : ''}`
  if (op.type === 'network') return `Rede · ${op.network?.address || ''}`
  if (op.type === 'container') return `Container · ${op.container?.action || ''} ${op.container?.name || ''}`
  return `Serviço · ${op.service?.action || ''} ${op.service?.name || ''}`
}

function interactiveOperationDetail(op: Operation) {
  if (op.type === 'apply_patch') return patchFiles(op.patch || '')
  if (op.type === 'command') return `${op.command?.cwd || '.'} · ${op.command?.timeout_seconds || 0}s${op.command?.network ? ' · network' : ''}`
  if (op.type === 'shell') return `${op.shell?.cwd || '.'} · ${op.shell?.timeout_seconds || 0}s${op.shell?.network ? ' · network' : ''}`
  if (op.type === 'sql') return `${op.sql?.timeout_seconds || 0}s · max ${op.sql?.max_rows || 0} rows`
  if (op.type === 'logs') return `limit ${op.logs?.limit || 0}${op.logs?.filter ? ' · filtro declarado' : ''}`
  if (op.type === 'filesystem') return op.filesystem?.action === 'write' ? `${op.filesystem.content?.length || 0} bytes` : `max ${op.filesystem?.max_bytes || 0} bytes`
  if (op.type === 'process') return op.process?.signal ? `signal ${op.process.signal}` : 'lista limitada'
  if (op.type === 'network') return `TCP connect · ${op.network?.timeout_seconds || 0}s`
  if (op.type === 'container') return `${op.container?.timeout_seconds || 60}s`
  return 'systemd scoped action'
}


type ManualPatch = { path: string; content: string }

function manualPatchEntries(planId: string, operations: Operation[]): ManualPatch[] {
  const stem = planId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'plan'
  return operations.filter((operation) => operation.type === 'apply_patch' && Boolean(operation.patch?.trim())).map((operation, index) => ({
    path: `patches/${stem}-${String(index + 1).padStart(2, '0')}.patch`,
    content: operation.patch!.endsWith('\n') ? operation.patch! : `${operation.patch!}\n`,
  }))
}

function shellQuote(value: string) { return `'${value.replace(/'/g, `'"'"'`)}'` }
function manualCommand(command: { argv: string[]; cwd: string }) {
  const argv = (command.argv || []).map(shellQuote).join(' ')
  if (!argv) return ''
  return command.cwd && command.cwd !== '.' ? `(cd ${shellQuote(command.cwd)} && ${argv})` : argv
}
function buildManualCommandBatch(patches: ManualPatch[], operations: Operation[], verification: Array<{ argv: string[]; cwd: string }>) {
  const lines = ['set -eu', '', '# Validar e aplicar os patches guardados pelo Wharnex.']
  for (const patch of patches) lines.push(`git apply --check -- ${shellQuote(patch.path)}`)
  for (const patch of patches) lines.push(`git apply -- ${shellQuote(patch.path)}`)
  const commands = operations.filter((operation) => operation.type === 'command').map((operation) => operation.command ? manualCommand(operation.command) : '').filter(Boolean)
  if (commands.length) lines.push('', '# Operações declaradas no plano.', ...commands)
  const checks = verification.map(manualCommand).filter(Boolean)
  if (checks.length) lines.push('', '# Verificações declaradas no plano.', ...checks)
  return `${lines.join('\n')}\n`
}

function planPatchFiles(patch: string): ChatChangeFile[] {
  return patch.replace(/\r\n/g, '\n').split(/(?=^diff --git )/m).filter((block) => block.trim()).map((block) => {
    const newPath = /^\+\+\+\s+(?:b\/)?(.+)$/m.exec(block)?.[1]?.trim()
    const oldPath = /^---\s+(?:a\/)?(.+)$/m.exec(block)?.[1]?.trim()
    const headerPath = /^diff --git a\/(\S+) b\/(\S+)$/m.exec(block)?.[2]
    const path = newPath && newPath !== '/dev/null' ? newPath : oldPath && oldPath !== '/dev/null' ? oldPath : headerPath || 'ficheiro'
    const additions = block.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
    const deletions = block.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).length
    return { path, additions, deletions, diff: block.endsWith('\n') ? block : `${block}\n` }
  })
}

function PlanPatchDiff({ sessionId, patch }: { sessionId: string; patch: string }) {
  const [selected, setSelected] = useState<ChatChangeFile>()
  const files = useMemo(() => planPatchFiles(patch), [patch])
  if (!files.length) return <span className="plan-diff-empty">Sem diff legível.</span>
  return <><div className="plan-diff-files">{files.map((file) => <button type="button" key={file.path} className="plan-diff-file" onClick={() => setSelected(file)} title={`Comparar ${file.path}`}><span><Icon name="file" size={12}/><b>{file.path}</b></span><span className="plan-diff-stats"><em>+{file.additions}</em><i>−{file.deletions}</i><Icon name="chevron" size={10}/></span></button>)}</div>{selected && <InternalWindow title={`Diff de ${selected.path}`} onClose={() => setSelected(undefined)} layerClassName="diff-inspector-backdrop"><section className="diff-inspector" role="dialog" aria-modal="false" aria-label={`Diff de ${selected.path}`}><header><div><strong>{selected.path}</strong><span>+{selected.additions} −{selected.deletions}</span></div><button type="button" className="icon-button light" onClick={() => setSelected(undefined)} aria-label="Fechar diff"><Icon name="close" size={13}/></button></header><ChangeDiffEditor sessionId={sessionId} file={selected}/></section></InternalWindow>}</>
}

function IntegrationQueue({ session, conflictGuidance, onConflictGuidance, onResolveManually, onResolveWithGPT }: { session: Session; conflictGuidance: string; onConflictGuidance?: (value: string) => void; onResolveManually?: () => void; onResolveWithGPT?: () => void }) {
	const pending = session.pending_host_changes || []
	if (!pending.length && !session.integration_conflict) return null
	return <section className="integration-queue" aria-label="Fila de integração">
		<div className="section-heading"><div><span className="panel-kicker">Concorrência</span><h3>Fila de integração</h3></div><StatusPill tone={session.integration_conflict ? 'danger' : 'success'}>{session.integration_conflict ? 'Conflito' : `${pending.length} verificado(s)`}</StatusPill></div>
		{pending.map((change) => <div className="operation" key={change.plan.plan_id}><div className="operation-index"><Icon name="apply" size={14}/></div><div className="operation-body"><strong>{change.plan.summary}</strong><span>{change.change_set ? `${change.change_set.state} · ${change.change_set.mutations.map((mutation) => mutation.path).join(', ')}` : 'Compatibilidade v1 · patch pendente'}</span></div></div>)}
		{session.integration_conflict && <div className="policy-box conflict-choice"><Icon name="git" size={17}/><div><strong>Escolha como resolver o conflito</strong><span>{session.integration_conflict.paths.join(', ')}</span><span>Pode resolver tudo manualmente, usar GPT, ou começar manualmente e delegar o restante.</span><textarea className="conflict-guidance" value={conflictGuidance} onChange={(event) => onConflictGuidance?.(event.target.value)} placeholder="Instrução auxiliar opcional para o GPT…" rows={2}/></div><div className="conflict-choice-actions"><button className="secondary-button" type="button" onClick={onResolveManually}>Resolver manualmente</button><button className="secondary-button" type="button" onClick={onResolveWithGPT}><Icon name="chatgpt" size={14}/> Resolver com GPT</button></div></div>}
	</section>
}

function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><div className="empty-mark">K/</div><h3>{title}</h3><p>{text}</p></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }
function patchFiles(patch: string) { const files = [...patch.matchAll(/^\+\+\+\s+b\/(.+)$/gm)].map((m) => m[1]); return files.length ? files.join(', ') : 'unified diff' }
