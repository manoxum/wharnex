import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { AppConfig, ChatChangeFile, ChatGPTActivity, HarnessEvent, Operation, Session } from '../types'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { riskLabel } from '../lib/risk'
import { api } from '../lib/api'
import { isDesktop } from '../lib/desktop'
import { ChatGPTDesktopPane } from './ChatGPTDesktopPane'
import { DirectChatGPTPane } from './DirectChatGPTPane'
import { MarkdownContent } from './MarkdownContent'
import { TranslatableMarkdown } from './TranslatableMarkdown'
import { ConflictResolverModal } from './ConflictResolverModal'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { buildExecutionTimeline, executionTimelineOverview } from '../lib/executionTimeline'
import { requestIdFromBundleName } from '../lib/bundlename'
import { sessionHostResolutionBlocked } from '../lib/attentionCenter'
import { activePendingRequestId } from '../lib/pendingRequest'
import { sessionCanExecutePlan, sessionNeedsExecutionConsent } from '../lib/executionRecovery'
import { SignalCore } from './SignalCore'
import { ChatArtifactLibrary } from './BundleExplorer'
import { ChangeDiffEditor } from './ChangeDiffEditor'

export type InspectorTab = 'files' | 'plan' | 'terminal' | 'chatgpt' | 'direct-chatgpt'

export function Inspector({ config, session, events, manualPrompt, busy, chat, chats, chatgptSurface, chatgptSuspended = false, activeTab, onTabChange, embedded = false, onChatGPTURL, onChatGPTActivity, onTransportFailure, onCancelPendingRequest, onExecute, onApproveDebug, onAdjustExecutionPlan, onRejectExecutionPlan, onRejectPendingChanges, onManualPlan, onPlanFile, onBundleFile, onSession, onResolveConflictWithGPT }: {
  config?: AppConfig
  session: Session
  events: HarnessEvent[]
  manualPrompt: string
  busy: boolean
  chat?: WorkspaceChat
  chats?: WorkspaceChat[]
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
  onApproveDebug?: () => Promise<void>
  onAdjustExecutionPlan?: () => void
  onRetryDependencyNetwork?: () => Promise<void>
  onRetryHostDependencyRepair?: () => Promise<void>
  onRejectExecutionPlan?: () => Promise<void>
  onRejectPendingChanges?: () => Promise<void>
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
  useEffect(() => { setManualJSON('') }, [chat?.id])
  const terminalEvents = useMemo(() => events.filter((e) => ['execution.queued', 'execution.dequeued', 'execution.started', 'execution.completed', 'execution.failed', 'execution.duplicate_blocked', 'execution.recovery_discarded', 'execution.recovery_reconciled', 'automation.execution_failed', 'automation.execution_joined', 'automation.infrastructure_blocked', 'command.started', 'command.output', 'command.completed', 'patch.started', 'patch.applied', 'host.apply_started', 'host.apply_failed', 'host.applied', 'host.pending_rejected', 'host.revert_started', 'host.reverted', 'host.restore_started', 'host.restore_failed', 'host.restore_recovery_started', 'host.restored', 'self_evolution.host_build_started', 'self_evolution.host_build_output', 'self_evolution.host_build_completed', 'self_evolution.host_build_failed', 'verification.started', 'verification.completed', 'verification.baseline_unchanged', 'verification.baseline_changed', 'automation.policy_blocked', 'automation.approval_required', 'automation.approval_auto_granted', 'repair.started', 'repair.prompt_ready', 'repair.prepare_failed', 'workflow.started', 'workflow.completed', 'workflow.step_failed', 'workflow.policy_blocked', 'workflow.continuation_started', 'workflow.prompt_ready', 'baseline.peer_updated', 'baseline.continuation_ready', 'baseline.bundle_fast_forwarded', 'baseline.bundle_superseded', 'baseline.execution_fast_forwarded', 'baseline.candidate_reverified', 'baseline.apply_blocked', 'baseline.reverify_failed', 'changeset.base_restored', 'changeset.verified', 'changeset.replayed', 'changeset.integrated', 'bundle.incomplete_impact_files', 'integration.host_state_preserved', 'integration.host_state_uncaptured', 'integration.verification_started', 'integration.verification_completed', 'integration.verification_unsupported', 'integration.verification_baseline_unchanged', 'integration.verification_baseline_compare_failed', 'integration.race', 'self_evolution.transaction_aborted', 'conflict.prompt_ready', 'host_dependency_repair.started', 'host_dependency_repair.command_started', 'host_dependency_repair.command_completed', 'host_dependency_repair.completed', 'host_dependency_repair.failed', 'host_dependency_repair.reverify_failed'].includes(e.type)), [events])
  const canExecute = sessionCanExecutePlan(session)
  const needsApproval = sessionNeedsExecutionConsent(session)
  const direct = session.execution_mode === 'unprotected'
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
          {direct && <StatusPill tone="warning">Unprotected</StatusPill>}
          {session.automation_mode === 'auto' && <StatusPill tone="success">Auto</StatusPill>}
          {session.automation_mode === 'auto_approve' && <StatusPill tone="warning">Auto + Aprovar</StatusPill>}
          {session.chat_transport_mode === 'manual' && <StatusPill tone="warning">Manual (sem DOM)</StatusPill>}
        </div>
      </header>}

      {!embedded && <nav className="tabs" aria-label="Inspector">
        <button className={selectedTab === 'files' ? 'active' : ''} onClick={() => selectTab('files')}><Icon name="folder" size={16}/> Ficheiros</button>
        <button className={selectedTab === 'plan' ? 'active' : ''} onClick={() => selectTab('plan')}><Icon name="plan" size={16}/> Plano</button>
        <button className={selectedTab === 'terminal' ? 'active' : ''} onClick={() => selectTab('terminal')}><Icon name="terminal" size={16}/> Execução <span className="tab-count">{terminalEvents.length}</span></button>
        <button className={selectedTab === 'chatgpt' ? 'active' : ''} onClick={() => selectTab('chatgpt')}><Icon name="agent" size={16}/> Engine {desktop && <span className="desktop-dot" title="Wharnex Desktop"/>}</button>
        <button className={selectedTab === 'direct-chatgpt' ? 'active' : ''} onClick={() => selectTab('direct-chatgpt')}><Icon name="chatgpt" size={16}/> ChatGPT</button>
      </nav>}

      <div className={`inspector-content ${(selectedTab === 'chatgpt' || selectedTab === 'direct-chatgpt') && desktop ? 'desktop-content' : ''} ${selectedTab === 'files' ? 'files-content' : ''}`}>
        {selectedTab === 'files' && <ChatArtifactLibrary sessionId={session.id} artifacts={session.artifacts} requestLineages={session.request_lineages}/>}
        {selectedTab === 'plan' && <PlanView session={session} busy={busy} canExecute={canExecute} needsApproval={needsApproval} canRejectPending={canReject} onExecute={onExecute} onApproveDebug={onApproveDebug} onAdjustExecutionPlan={onAdjustExecutionPlan} onRejectExecutionPlan={onRejectExecutionPlan} onRejectPendingChanges={onRejectPendingChanges} conflictGuidance={conflictGuidance} onConflictGuidance={setConflictGuidance} onResolveManually={() => setConflictResolverOpen(true)} onResolveWithGPT={() => void (async () => { const updated = await api.delegateConflictToGPT(session.id, [], conflictGuidance); onSession(updated); await onResolveConflictWithGPT?.(updated) })()} />}
        {selectedTab === 'terminal' && <TerminalView events={terminalEvents} />}
        {selectedTab === 'chatgpt' && session.chat_transport_mode === 'manual' && <ManualChatGPTPane session={session} manualPrompt={manualPrompt} manualJSON={manualJSON} setManualJSON={setManualJSON} busy={busy} copy={copy} onManualPlan={onManualPlan} onBundleFile={onBundleFile} />}
        {selectedTab === 'chatgpt' && session.chat_transport_mode !== 'manual' && !desktop && <ChatGPTWebFallback config={config} session={session} manualPrompt={manualPrompt} manualJSON={manualJSON} setManualJSON={setManualJSON} busy={busy} copy={copy} onManualPlan={onManualPlan} />}
        {desktop && <ChatGPTEnginePool
          visible={selectedTab === 'chatgpt'}
          globallySuspended={chatgptSuspended}
          chats={chats && chats.length ? chats : (chat ? [chat] : [])}
          activeChatId={chat?.id || ''}
          chatgptSurface={chatgptSurface}
          busy={busy}
          session={session}
          onChatGPTURL={onChatGPTURL}
          onChatGPTActivity={onChatGPTActivity}
          onTransportFailure={onTransportFailure}
          onCancelPendingRequest={onCancelPendingRequest}
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

// Manual chat transport mode: Wharnex never touches the ChatGPT DOM for
// this chat. The prompt is only ever shown here for the human to copy into
// ChatGPT themselves; a completed response bundle is only ever imported by
// the human downloading it and dropping/selecting it here — never
// auto-detected. Reuses the same prompt/legacy-JSON blocks ChatGPTWebFallback
// already renders for the "no Desktop bridge" case, since the two surfaces
// share the same "no automation available" shape; only the ZIP upload zone
// below is new.
function ManualChatGPTPane({ session, manualPrompt, manualJSON, setManualJSON, busy, copy, onManualPlan, onBundleFile }: {
  session: Session
  manualPrompt: string
  manualJSON: string
  setManualJSON: (value: string) => void
  busy: boolean
  copy: (text: string) => Promise<void>
  onManualPlan: (json: string) => Promise<void>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
}) {
  const [dragOver, setDragOver] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<{ tone: 'success' | 'danger'; message: string } | undefined>()
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function submitBundleFile(file: File) {
    setUploadStatus(undefined)
    const requestId = requestIdFromBundleName(file.name)
    if (!requestId) {
      setUploadStatus({ tone: 'danger', message: `Nome de ficheiro não reconhecido: ${file.name}. Esperado whx_bundle_res_<chat_id>_<request_id>.zip.` })
      return
    }
    setUploading(true)
    try {
      const buffer = await file.arrayBuffer()
      const contentBase64 = arrayBufferToBase64(buffer)
      const message = await onBundleFile(contentBase64, requestId, file.name)
      setUploadStatus({ tone: 'success', message: message || 'Bundle importado.' })
    } catch (error) {
      setUploadStatus({ tone: 'danger', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setUploading(false)
    }
  }

  return <div className="chatgpt-view manual-transport-view">
    <div className="section-heading"><div><span className="panel-kicker">Chat transport</span><h3>Manual</h3></div><StatusPill tone="warning">Sem automação DOM</StatusPill></div>
    <div className="provider-card warning-card"><Icon name="clipboard" size={18}/><div><strong>O Wharnex não interage com o ChatGPT neste chat</strong><span>Copie o prompt abaixo e cole-o você mesmo no ChatGPT. Quando a resposta terminar, descarregue o bundle gerado e solte-o (ou selecione-o) aqui para o entregar ao Wharnex.</span></div></div>
    <div className="bridge-actions">
      <a className="text-button" href={api.bundleURL(session.id)}><Icon name="download" size={15}/> Contexto ZIP</a>
      <a className="text-button" href="https://chatgpt.com/" target="_blank" rel="noreferrer"><Icon name="external" size={15}/> Abrir ChatGPT</a>
    </div>
    <label className="field-label">Prompt preparado</label>
    <div className="code-box prompt-box"><button className="code-copy" disabled={!manualPrompt} onClick={() => void copy(manualPrompt)}><Icon name="copy" size={14}/> Copiar</button><pre>{manualPrompt || 'Envie uma mensagem no Agent para gerar o prompt.'}</pre></div>
    <label className="field-label">Bundle de resposta</label>
    <div
      className={`manual-bundle-dropzone${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file) void submitBundleFile(file)
      }}
      onClick={() => fileInputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <Icon name="file" size={18}/>
      <span>{uploading ? 'A importar…' : 'Arraste o bundle .zip descarregado do ChatGPT para aqui, ou clique para selecionar'}</span>
      <input ref={fileInputRef} type="file" accept=".zip" hidden disabled={busy || uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void submitBundleFile(file); e.target.value = '' }} />
    </div>
    {uploadStatus && <div className={`provider-card ${uploadStatus.tone === 'success' ? 'success-card' : 'danger-card'}`}><Icon name={uploadStatus.tone === 'success' ? 'check' : 'close'} size={16}/><span>{uploadStatus.message}</span></div>}
    <label className="field-label" htmlFor="manual-json">Plano JSON recebido (protocolo legado)</label>
    <textarea id="manual-json" className="json-input" spellCheck={false} value={manualJSON} onChange={(e) => setManualJSON(e.target.value)} placeholder={'{\n  "protocol": "harness.execution/v1",\n  ...\n}'} />
    <button className="primary-button full" disabled={busy || !manualJSON.trim()} onClick={() => onManualPlan(manualJSON)}>Validar plano no Harness</button>
  </div>
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

// The renderer exposes exactly one human-facing Supervisor pane. Background
// automation is owned by the Desktop process' three hidden worker browsers and
// the durable backend queue, so React must not keep a pane mounted per chat.
// Re-rendering the same component with another chat id preserves one Supervisor
// surface while Desktop coalesces navigation around submit/write critical phases.
function ChatGPTEnginePool({ visible, globallySuspended, chats, activeChatId, chatgptSurface, busy, session, onChatGPTURL, onChatGPTActivity, onTransportFailure, onCancelPendingRequest, onPlanFile, onBundleFile }: {
  visible: boolean
  globallySuspended: boolean
  chats: WorkspaceChat[]
  activeChatId: string
  chatgptSurface?: { cacheKey: string; title: string; url?: string; conflictId?: string }
  busy: boolean
  session: Session
  onChatGPTURL: (url: string) => boolean
  onChatGPTActivity?: (activity: ChatGPTActivity) => void
  onTransportFailure?: (requestId: string, reason: string) => void
  onCancelPendingRequest?: (requestId: string) => Promise<void>
  onPlanFile: (json: string, requestId: string) => Promise<string>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
}) {
  const activeChat = chats.find((chat) => chat.id === activeChatId)
  // React commits the selected chat id before an uncached Session fetch can
  // finish. Never mount a remote surface using the previous chat's Session in
  // that interval: its pending request/conflict identity belongs elsewhere.
  if (!activeChat || activeChat.sessionId !== session.id) return <div className="desktop-chatgpt-pool" hidden />
  const surface = chatgptSurface
  const manualTransport = session.chat_transport_mode === 'manual'
  return <div className="desktop-chatgpt-pool" hidden={!visible}>
    <div className="desktop-chatgpt-pool-item active">
      <ChatGPTDesktopPane
        suspended={globallySuspended || !visible || manualTransport}
        busy={busy}
        chatId={surface?.cacheKey || activeChat.id}
        chatTitle={surface?.title || activeChat.title}
        chatgptUrl={surface ? surface.url : activeChat.chatgptUrl}
        pendingRequestId={activePendingRequestId(session)}
        sessionId={session.id}
        chatHash={session.context.workspace_sha256 || session.context.manifest.sha256}
        requestedAt={session.request_lineages?.[activePendingRequestId(session)]?.created_at || session.created_at}
        recoveryBootstrap={session.last_manual_prompt}
        onChatGPTURL={onChatGPTURL}
        onActivity={onChatGPTActivity}
        onTransportFailure={onTransportFailure}
        onCancelPendingRequest={onCancelPendingRequest}
        onPlanFile={onPlanFile}
        onBundleFile={onBundleFile}
      />
    </div>
  </div>
}

export function PlanView({ session, busy = false, canExecute = false, needsApproval = false, canRejectPending = false, onExecute, onApproveDebug, onAdjustExecutionPlan, onRejectExecutionPlan, onRejectPendingChanges, conflictGuidance = '', onConflictGuidance, onResolveManually, onResolveWithGPT }: {
  session: Session
  busy?: boolean
  canExecute?: boolean
  needsApproval?: boolean
  canRejectPending?: boolean
  onExecute?: (approved: boolean) => Promise<void>
  onApproveDebug?: () => Promise<void>
  onAdjustExecutionPlan?: () => void
  onRejectExecutionPlan?: () => Promise<void>
  onRejectPendingChanges?: () => Promise<void>
  conflictGuidance?: string
  onConflictGuidance?: (value: string) => void
  onResolveManually?: () => void
  onResolveWithGPT?: () => void
}) {
  const [manualNotice, setManualNotice] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  useEffect(() => { setManualNotice('') }, [session.plan?.plan_id])
	const integration = <IntegrationQueue session={session} conflictGuidance={conflictGuidance} onConflictGuidance={onConflictGuidance} onResolveManually={onResolveManually} onResolveWithGPT={onResolveWithGPT} />
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
  const policyStatus = session.policy ? (session.policy.allowed ? (workflow ? 'Probe autorizada' : 'Policy OK') : 'Bloqueado') : 'Histórico'
  const pendingCount = session.pending_host_changes?.length || 0

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
    <div className="plan-control-surface">
      <div className="plan-control-primary">
        <div className="plan-control-copy"><span className="plan-control-mark"><Icon name="plan" size={15}/></span><div><span className="panel-kicker">Contrato de execução</span><strong>{canExecute ? 'Aguardando a sua decisão' : pendingCount ? 'Integração pendente de recuperação' : 'Plano registado'}</strong><span>{needsApproval ? 'Uma aprovação cobre a execução Protected e a integração automática no host; correções só voltam a pedir decisão quando introduzem novo impacto.' : pendingCount ? 'A aplicação ao host já foi autorizada pelo plano. Não existe uma segunda aprovação de Apply; apenas a recuperação do bloqueio pendente.' : 'Depois de uma execução Protected autorizada e verificada, a integração no host acontece sem uma segunda aprovação.'}</span></div></div>
        <div className="plan-decision-actions">
          {session.state === 'debug_approval_required' && session.plan.debug && <button type="button" className="apply-button" disabled={busy} onClick={() => void onApproveDebug?.()}><Icon name="terminal" size={14}/> {session.plan.debug.protocol === 'harness.interactive/v2' ? `Autorizar Interactive v2 · ${session.plan.debug.target} · ${session.plan.debug.access || 'observe'}` : session.plan.debug.target === 'host' && session.plan.debug.access === 'modify' ? 'Autorizar alteração de debug no host' : `Autorizar debug ${session.plan.debug.target}`}</button>}
          {busy && session.plan.debug?.protocol === 'harness.interactive/v2' && <button type="button" className="danger-button" onClick={() => void api.cancelInteractive(session.id).then(() => setManualNotice('Cancelamento da ronda Interactive v2 solicitado.')).catch((error) => setManualNotice(error instanceof Error ? error.message : String(error)))}><Icon name="close" size={13}/> Parar ronda</button>}
          {canExecute && <><button type="button" className="secondary-button" disabled={busy} onClick={() => void onRejectExecutionPlan?.()}><Icon name="trash" size={13}/> Rejeitar</button><button type="button" className="secondary-button" disabled={busy} onClick={() => onAdjustExecutionPlan?.()}><Icon name="edit" size={13}/> Ajustar</button><button type="button" className={session.execution_mode === 'unprotected' ? 'danger-button' : 'apply-button'} disabled={busy} onClick={() => void onExecute?.(true)}><Icon name="check" size={14}/> {session.execution_mode === 'unprotected' ? 'Confirmar execução no host' : 'Aceitar e executar'}</button></>}
          {canRejectPending && <button type="button" className="secondary-button" disabled={busy} onClick={() => void onRejectPendingChanges?.()}><Icon name="trash" size={13}/> Rejeitar</button>}
        </div>
      </div>
      {manualPatches.length > 0 && <div className="plan-manual-tools"><div className="plan-manual-copy"><span className="plan-manual-mark"><Icon name="download" size={13}/></span><div><span className="panel-kicker">Fallback manual</span><strong>Aplicação alternativa dos patches</strong><small>Guarde uma cópia em /patches ou copie um lote com quoting seguro para executar manualmente na raiz do projeto.</small></div></div><div className="plan-manual-actions"><button type="button" className="secondary-button" disabled={manualBusy} onClick={() => void savePatchesToProject()}><Icon name="download" size={13}/> Descarregar patches</button><button type="button" className="secondary-button" disabled={manualBusy} onClick={() => void copyManualCommands()}><Icon name="copy" size={13}/> Copiar lote de comandos</button></div></div>}
    </div>
    {manualNotice && <p className="plan-manual-notice" role="status">{manualNotice}</p>}
    <div className="section-heading plan-heading"><div><span className="panel-kicker">{plan.debug ? `Debug ${plan.debug.target} · ${session.workflow_round || 0}/6` : workflow ? `Workflow local ${session.workflow_round || 0}/6 · sandbox` : plan.protocol}</span><h3>{plan.summary}</h3></div><StatusPill tone={policyTone}>{policyStatus}</StatusPill></div>
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


function interactiveScopeSummary(scope?: NonNullable<import('../types').ExecutionPlan['debug']>['scope']) {
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
  return <><div className="plan-diff-files">{files.map((file) => <button type="button" key={file.path} className="plan-diff-file" onClick={() => setSelected(file)} title={`Comparar ${file.path}`}><span><Icon name="file" size={12}/><b>{file.path}</b></span><span className="plan-diff-stats"><em>+{file.additions}</em><i>−{file.deletions}</i><Icon name="chevron" size={10}/></span></button>)}</div>{selected && <div className="diff-inspector-backdrop" data-chatgpt-overlay-blocker="true" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(undefined) }}><section className="diff-inspector" role="dialog" aria-modal="true" aria-label={`Diff de ${selected.path}`}><header><div><strong>{selected.path}</strong><span>+{selected.additions} −{selected.deletions}</span></div><button type="button" className="icon-button light" onClick={() => setSelected(undefined)} aria-label="Fechar diff"><Icon name="close" size={13}/></button></header><ChangeDiffEditor sessionId={sessionId} file={selected}/></section></div>}</>
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

export function TerminalView({ events }: { events: HarnessEvent[] }) {
  const entries = useMemo(() => buildExecutionTimeline(events), [events])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const expandable = entries.filter((entry) => (entry.kind === 'command' || entry.kind === 'patch') && (entry.output || entry.rationale)).slice(-5)
    setExpanded(new Set(expandable.map((entry) => entry.id)))
    endRef.current?.scrollIntoView?.({ block: 'end' })
    // This component mounts only while the Execução tab is active; the first
    // render intentionally expands only the five most recent output-bearing commands.
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [events.length])

  if (!events.length) return <Empty title="Execução limpa" text="Operações, verificações, aplicação no host, stdout e stderr aparecerão aqui em tempo real. O terminal interativo continua no modo Editor." />
  const overview = executionTimelineOverview(entries)
  const active = overview === 'active'
  const failed = overview === 'failed'
  const recovered = overview === 'recovered'
  const succeeded = overview === 'success'
  return <div className="execution-view">
    <div className="execution-overview">
      <div><span className="panel-kicker">Execução observável</span><h3>{active ? 'Operação em curso' : failed ? 'Execução com falha' : recovered ? 'Execução recuperada' : succeeded ? 'Execução concluída' : 'Atividade de execução'}</h3><p>Cada comando é um único item: ao expandir, mostra o motivo e o propósito declarados pela IA, além de stdout, stderr, erros, data/hora e duração. A vista acompanha o fim enquanto esta aba estiver ativa.</p></div>
      <StatusPill tone={failed ? 'danger' : active ? 'warning' : 'success'}>{active ? 'LIVE' : failed ? 'Falhou' : recovered ? 'Recuperada' : succeeded ? 'Concluída' : 'Atualizada'}</StatusPill>
    </div>
    <div className="execution-timeline">
      {entries.map((entry, index) => {
        const canExpand = Boolean(entry.output || entry.rationale)
        const isExpanded = expanded.has(entry.id)
		const previous = index > 0 ? entries[index - 1] : undefined
		const showGroup = !previous || previous.rootRequestId !== entry.rootRequestId || previous.iterationKind !== entry.iterationKind
        return <Fragment key={entry.id}>{showGroup && <div className={`execution-group-header kind-${entry.iterationKind}`}><strong>{executionKindLabel(entry.iterationKind)}</strong><a href={`#request-${entry.rootRequestId}`} title={entry.rootRequestId}>{entry.rootRequestId ? entry.rootRequestId.replace(/^req_/, '').slice(0, 22) : 'atividade da sessão'}</a></div>}<div className={`execution-command-card ${entry.running ? 'running' : ''}`}>
          <div className="execution-event">
            <span className={`lamp ${entry.tone === 'fail' ? 'fail' : entry.tone === 'warning' ? 'warning' : ''} ${entry.running ? 'blinking' : ''}`} />
            <div className="execution-event-copy"><strong>{entry.title}</strong><span>{formatExecutionDate(entry.timestamp)}{entry.detail ? ` · ${entry.detail}` : ''}{entry.durationMs !== undefined ? ` · ${formatDuration(entry.durationMs)}` : ''}</span></div>
            <div className="execution-event-actions"><code>{entry.badge}</code>{canExpand && <button type="button" className={isExpanded ? 'execution-expand open' : 'execution-expand'} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next })} title={isExpanded ? 'Ocultar detalhes' : 'Mostrar detalhes'} aria-label={isExpanded ? 'Ocultar detalhes' : 'Mostrar detalhes'}>⌄</button>}</div>
          </div>
          {canExpand && isExpanded && <div className="execution-command-output" role="log" aria-label="Detalhes da execução">
            {entry.rationale && <div className="execution-rationale"><strong>Porquê / propósito</strong><span>{entry.rationale}</span></div>}
            {entry.outputSegments.length ? entry.outputSegments.map((segment, segmentIndex) => <pre key={`${entry.id}-output-${segmentIndex}`} className={`execution-output-segment ${segment.stream}`} data-stream={segment.stream} aria-label={segment.stream === 'stderr' ? 'stderr' : undefined}>{segment.text}</pre>) : entry.output ? <pre className="execution-output-segment meta">{entry.output}</pre> : null}
          </div>}
        </div></Fragment>
      })}
      <div ref={endRef}/>
    </div>
  </div>
}

function executionKindLabel(kind: 'standard' | 'repair' | 'revert_restore' | 'improvement' | 'evidence' | 'conflict') {
	return kind === 'repair' ? 'Resolução de erro' : kind === 'revert_restore' ? 'Reposição de reversão' : kind === 'improvement' ? 'Melhoria contínua' : kind === 'evidence' ? 'Extração de informações' : kind === 'conflict' ? 'Resolução de conflito' : 'Execução principal'
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
