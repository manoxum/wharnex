import type { IconName } from '../../../presentation/chrome/Icon'
import { Icon } from '../../../presentation/chrome/Icon'
import { IconButton } from '../../../presentation/workbench'
import { memoryLabel, short, timeLabel } from './runtimeLabels'

type ChatRef = { id: string; title: string; sessionId: string }
type Props = {
  agent: DesktopAgentRuntimeAgent
  projectPath: string
  projectName: string
  foreignProject?: string
  projectId?: string
  chat?: ChatRef
  task?: DesktopAgentRuntimeTask
  taskIsCurrent: boolean
  stateLabel: string
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onFocusProject?: (projectPath: string) => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid min-w-0 grid-cols-[minmax(4.5rem,.65fr)_minmax(0,1.35fr)] items-start gap-x-3 border-b border-[var(--theme-border-soft)] py-2 last:border-b-0">
    <dt className="text-[calc(13px*var(--ui-font-scale))] leading-5 text-[var(--theme-text-muted)]">{label}</dt>
    <dd className="m-0 min-w-0 whitespace-normal [overflow-wrap:anywhere] select-text font-mono text-[calc(13px*var(--ui-font-scale))] leading-5 text-[var(--theme-text-soft)]">{children}</dd>
  </div>
}

function LinkedValue({ children, title, action, label, disabled, icon = 'external' }: {
  children: React.ReactNode; title: string; action: () => void; label: string; disabled: boolean; icon?: IconName
}) {
  return <span className="flex min-w-0 items-center gap-1.5">
    <span className="min-w-0 truncate" title={title}>{children}</span>
    <IconButton className="!size-7 !min-h-7" icon={icon} label={label} title={label} onClick={action} disabled={disabled}/>
  </span>
}

function DetailsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <section aria-label={label} className="min-w-0">
    <h3 className="m-0 px-1 pb-1 text-[calc(11px*var(--ui-font-scale))] font-semibold uppercase tracking-[.08em] text-[var(--theme-text-muted)]">{label}</h3>
    <dl className="m-0 grid min-w-0">{children}</dl>
  </section>
}

export function AgentRuntimeDetails({ agent, projectPath, projectName, foreignProject, projectId, chat, task, taskIsCurrent, stateLabel, onGoToChat, onFocusProject }: Props) {
  const taskError = foreignProject ? '' : agent.error || task?.last_error
  return <div className="grid min-w-0 gap-2">
    {foreignProject && <p className="m-0 rounded-lg border border-[color-mix(in_srgb,var(--warning)_38%,var(--theme-border-soft))] bg-[color-mix(in_srgb,var(--warning)_9%,var(--theme-surface))] px-3 py-2.5 text-[calc(13px*var(--ui-font-scale))] leading-5 text-[var(--theme-text-muted)] [&_b]:font-mono [&_b]:text-[var(--theme-text)]" role="status">Ocupado com uma tarefa do projeto <b title={foreignProject}>{projectName}</b>. Fica disponível para este projeto quando terminar.</p>}
    <DetailsGroup label="Atividade">
      <Row label="Loop">{agent.loop_active === false ? 'Parado' : 'Ativo'}</Row>
      {!foreignProject && <Row label="Tarefa">{task ? `${task.type} · ${task.task_id}${taskIsCurrent ? '' : ' · última'}` : 'Sem tarefa registada'}</Row>}
      {!foreignProject && <Row label="Estado da tarefa">{short(task?.status)}</Row>}
      <Row label="Estado">{stateLabel}</Row>
    </DetailsGroup>
    <DetailsGroup label="Sessão">
      <Row label="Chat">{chat
        ? <LinkedValue title={agent.chat_id} label={`Abrir o chat ${chat.title}`} action={() => onGoToChat?.(chat.id, chat.sessionId)} disabled={!onGoToChat}>{chat.title}</LinkedValue>
        : foreignProject && agent.chat_id ? `Conversa do projeto ${projectName}` : short(agent.chat_id)}</Row>
      <Row label="Projeto">{projectId
        ? projectId !== projectPath
          ? <LinkedValue icon="workspace" title={projectId} label={`Trazer o projeto ${projectName} para foco`} action={() => onFocusProject?.(projectId)} disabled={!onFocusProject}>{projectName}</LinkedValue>
          : <span title={projectId}>{projectName}</span>
        : '—'}</Row>
      {agent.role === 'supervisor' && <Row label="Vínculo">{agent.binding_hold ? `Retido · ${agent.binding_hold}` : agent.chat_id ? 'Livre para outro chat' : 'Sem chat'}</Row>}
    </DetailsGroup>
    <DetailsGroup label="Instância">
      <Row label="RAM (RSS)">{memoryLabel(agent.memory?.rss_bytes, agent.memory?.available)}{agent.memory?.shared_process ? ' · processo partilhado' : ''}</Row>
      <Row label="Navegador">{agent.browser.available ? `WebContents #${agent.browser.web_contents_id} · PID ${agent.browser.os_process_id || '—'}` : 'Ainda não criado'}</Row>
      {!foreignProject && <Row label="Página"><span title={agent.browser.url}>{short(agent.browser.title || agent.browser.url, agent.browser.available ? 'Sem página carregada' : '—')}</span></Row>}
    </DetailsGroup>
    {taskError && <p role="status" aria-label="Diagnóstico do agente" className="m-0 grid gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--danger)_30%,var(--theme-border-soft))] bg-[color-mix(in_srgb,var(--danger)_7%,var(--theme-surface))] px-3 py-2 text-sm leading-5 text-[color-mix(in_srgb,var(--danger)_72%,var(--theme-text))]">
      <strong className="font-semibold">Detalhe do erro</strong>
      <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{taskError}</span>
    </p>}
    {!foreignProject && <details className="group min-w-0 rounded-lg border border-[var(--theme-border-soft)]">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-[var(--theme-text-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]">
        <span>Detalhes da execução</span><span className="flex min-w-0 items-center gap-2 text-[var(--theme-text-muted)]">
          {task ? `${task.attempt}/${task.max_attempts} tentativas` : 'Sem tarefa ativa'}
          <Icon name="chevron" size={14}/>
        </span>
      </summary>
      <dl aria-label={`Diagnóstico de ${agent.label}`} className="m-0 grid border-t border-[var(--theme-border-soft)] px-3">
        <Row label="Pedido">{short(task?.request_id)}</Row>
        <Row label="Lineage">{short(task?.root_request_id)}</Row>
        <Row label="Conversa">{short(task?.conversation_id)}</Row>
        <Row label="Tentativa">{task ? `${task.attempt}/${task.max_attempts}` : '—'}</Row>
        <Row label="Último claim">{timeLabel(agent.last_claim_at)}</Row>
        {agent.residency && <>
          <Row label="Residência">{short(agent.residency.resident_lane)} · rotação #{agent.residency.rotation_position + 1}</Row>
          <Row label="Dwell mínimo">{timeLabel(agent.residency.min_resident_until)}</Row>
          <Row label="Assignment epoch">{agent.residency.assignment_epoch}{agent.residency.navigation_in_progress ? ' · a navegar' : ''}{agent.residency.non_preemptive ? ' · não preemptível' : ''}</Row>
        </>}
        <Row label="Lease">{timeLabel(task?.lease_expires_at)}</Row>
        <Row label="not_before">{timeLabel(task?.not_before)}</Row>
        {agent.activity && agent.task && <Row label="Fase desde">{timeLabel(agent.activity.since)}</Row>}
      </dl>
    </details>}
  </div>
}
