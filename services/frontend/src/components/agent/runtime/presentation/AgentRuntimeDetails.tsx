import { translate as uiText, formatMessage } from '../../../../lib/workspace/localization'
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
  return <div className="grid min-w-0 grid-cols-[minmax(4rem,.65fr)_minmax(0,1.35fr)] items-start gap-x-2 border-b border-[var(--theme-border-soft)] py-1 last:border-b-0">
    <dt className="text-[calc(9px*var(--ui-font-scale))] leading-4 text-[var(--theme-text-muted)]">{label}</dt>
    <dd className="m-0 min-w-0 whitespace-normal [overflow-wrap:anywhere] select-text font-mono text-[calc(10px*var(--ui-font-scale))] leading-4 text-[var(--theme-text-soft)]">{children}</dd>
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
    <h3 className="m-0 px-1 pb-0.5 text-[calc(9px*var(--ui-font-scale))] font-semibold text-[var(--theme-text-muted)]">{label}</h3>
    <dl className="m-0 grid min-w-0">{children}</dl>
  </section>
}

export function AgentRuntimeDetails({ agent, projectPath, projectName, foreignProject, projectId, chat, task, taskIsCurrent, stateLabel, onGoToChat, onFocusProject }: Props) {
  const taskError = foreignProject ? '' : agent.error || task?.last_error
  return <div className="grid min-w-0 gap-1.5">
    {foreignProject && <p className="m-0 rounded-md border border-[color-mix(in_srgb,var(--warning)_38%,var(--theme-border-soft))] bg-[color-mix(in_srgb,var(--warning)_9%,var(--theme-surface))] px-2.5 py-1.5 text-[calc(10.5px*var(--ui-font-scale))] leading-4 text-[var(--theme-text-muted)] [&_b]:font-mono [&_b]:text-[var(--theme-text)]" role="status">{uiText("Ocupado com uma tarefa do projeto")}{' '}<b title={foreignProject}>{projectName}</b>. {uiText("Disponível quando terminar.")}</p>}
    <DetailsGroup label={uiText("Atividade")}>
      <Row label="Loop">{agent.loop_active === false ? uiText("Parado") : uiText("Ativo")}</Row>
      {!foreignProject && <Row label={uiText("Tarefa")}>{task ? `${task.type} · ${task.task_id}${taskIsCurrent ? '' : ` ${uiText("· última")}`}` : uiText("Sem tarefa registada")}</Row>}
      {!foreignProject && <Row label={uiText("Estado da tarefa")}>{short(task?.status)}</Row>}
      <Row label={uiText("Estado")}>{uiText(stateLabel)}</Row>
    </DetailsGroup>
    <DetailsGroup label={uiText("Sessão")}>
      <Row label="Chat">{chat
        ? <LinkedValue title={agent.chat_id} label={formatMessage("Abrir o chat {title}", { title: chat.title })} action={() => onGoToChat?.(chat.id, chat.sessionId)} disabled={!onGoToChat}>{chat.title}</LinkedValue>
        : foreignProject && agent.chat_id ? formatMessage("Conversa do projeto {name}", { name: projectName }) : short(agent.chat_id)}</Row>
      <Row label={uiText("Projeto")}>{projectId
        ? projectId !== projectPath
          ? <LinkedValue icon="workspace" title={projectId} label={formatMessage("Trazer o projeto {name} para foco", { name: projectName })} action={() => onFocusProject?.(projectId)} disabled={!onFocusProject}>{projectName}</LinkedValue>
          : <span title={projectId}>{projectName}</span>
        : '—'}</Row>
      {agent.role === 'supervisor' && <Row label={uiText("Vínculo")}>{agent.binding_hold ? formatMessage("Retido · {reason}", { reason: agent.binding_hold }) : agent.chat_id ? uiText("Livre para outro chat") : uiText("Sem chat")}</Row>}
    </DetailsGroup>
    <DetailsGroup label={uiText("Instância")}>
      <Row label="RAM (RSS)">{memoryLabel(agent.memory?.rss_bytes, agent.memory?.available)}{agent.memory?.shared_process ? ` ${uiText("· processo partilhado")}` : ''}</Row>
      <Row label={uiText("Navegador")}>{agent.browser.available ? `WebContents #${agent.browser.web_contents_id} · PID ${agent.browser.os_process_id || '—'}` : uiText("Ainda não criado")}</Row>
      {!foreignProject && <Row label={uiText("Página")}><span title={agent.browser.url}>{short(agent.browser.title || agent.browser.url, agent.browser.available ? uiText("Sem página carregada") : '—')}</span></Row>}
    </DetailsGroup>
    {taskError && <p role="status" aria-label={uiText("Diagnóstico do agente")} className="m-0 grid gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--danger)_30%,var(--theme-border-soft))] bg-[color-mix(in_srgb,var(--danger)_7%,var(--theme-surface))] px-3 py-2 text-sm leading-5 text-[color-mix(in_srgb,var(--danger)_72%,var(--theme-text))]">
      <strong className="font-semibold">{uiText("Detalhe do erro")}</strong>
      <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{taskError}</span>
    </p>}
    {!foreignProject && <details className="group min-w-0 rounded-lg border border-[var(--theme-border-soft)]">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-[var(--theme-text-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]">
        <span>{uiText("Detalhes da execução")}</span><span className="flex min-w-0 items-center gap-2 text-[var(--theme-text-muted)]">
          {task ? formatMessage("{attempt}/{max} tentativas", { attempt: task.attempt, max: task.max_attempts }) : uiText("Sem tarefa ativa")}
          <Icon name="chevron" size={14}/>
        </span>
      </summary>
      <dl aria-label={formatMessage("Diagnóstico de {name}", { name: agent.label })} className="m-0 grid border-t border-[var(--theme-border-soft)] px-3">
        <Row label={uiText("Pedido")}>{short(task?.request_id)}</Row>
        <Row label="Lineage">{short(task?.root_request_id)}</Row>
        <Row label={uiText("Conversa")}>{short(task?.conversation_id)}</Row>
        <Row label={uiText("Tentativa")}>{task ? `${task.attempt}/${task.max_attempts}` : '—'}</Row>
        <Row label={uiText("Último claim")}>{timeLabel(agent.last_claim_at)}</Row>
        {agent.residency && <>
          <Row label={uiText("Residência")}>{short(agent.residency.resident_lane)} {' '}{uiText("· rotação #")}{agent.residency.rotation_position + 1}</Row>
          <Row label={uiText("Dwell mínimo")}>{timeLabel(agent.residency.min_resident_until)}</Row>
          <Row label="Assignment epoch">{agent.residency.assignment_epoch}{agent.residency.navigation_in_progress ? ` ${uiText("· a navegar")}` : ''}{agent.residency.non_preemptive ? ` ${uiText("· não preemptível")}` : ''}</Row>
        </>}
        <Row label="Lease">{timeLabel(task?.lease_expires_at)}</Row>
        <Row label="not_before">{timeLabel(task?.not_before)}</Row>
        {agent.activity && agent.task && <Row label={uiText("Fase desde")}>{timeLabel(agent.activity.since)}</Row>}
      </dl>
    </details>}
  </div>
}
