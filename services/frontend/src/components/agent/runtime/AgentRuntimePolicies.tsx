import { confirmDialog } from '../../../lib/desktop/bridge/appDialog'
import { Icon } from '../../presentation/chrome/Icon'
import { short, timeLabel, useAgentRuntimePolicyActions, workerTaskTypeGroups } from './agentRuntimePolicyActions'

const confirmRelease = () => confirmDialog({
  title: 'Libertar suspensão por rate limit?',
  message: 'Os Workers voltam a enviar pedidos ao ChatGPT antes do fim do cooldown. Se a conta ainda estiver limitada, um novo HTTP 429 abre outra suspensão.',
  tone: 'warning', confirmLabel: 'Libertar agora', cancelLabel: 'Manter suspensão',
})

// The Agent drawer's presentation of the runtime policies.
export function AgentRuntimePolicies({ runtime, onRuntime, onError }: {
  runtime: DesktopAgentRuntimeState
  onRuntime: (runtime: DesktopAgentRuntimeState) => void
  onError?: (message: string) => void
}) {
  const {
    busy, workerPauseMode, setWorkerPauseMode, workerPauseMinutes, setWorkerPauseMinutes,
    workerPauseScope, setWorkerPauseScope, workerPauseTaskTypes, setWorkerPauseTaskTypes,
    scaleSupervisors, scaleWorkers, updatePolicies, scaleAutoScaleCeiling, scaleAutoScaleSupervisorCeiling,
    suspendWorkers, releaseRateLimit, resumeWorkers,
  } = useAgentRuntimePolicyActions({ runtime, onRuntime, onError, confirmRelease })

  return <>
    <section className="agent-runtime-policy-section" aria-label="Proteção do provedor">
      <header className="agent-runtime-policy-heading">
        <div><span>Proteção do provedor</span><h3>Retoma e rate limit</h3></div>
        <small>Controla quando os Workers param, retomam e voltam a pressionar o ChatGPT.</small>
      </header>
      <div className="agent-runtime-policy-grid">
        <div className={`agent-runtime-worker-policy agent-runtime-policy-wide${runtime.worker_pause?.paused ? ' is-paused' : ''}`}>
          <div className="agent-runtime-worker-policy-heading">
            <div className="agent-runtime-pause-copy"><span className="agent-runtime-policy-chip">Workers</span><strong>Cooldown durável dos Workers</strong><small>{runtime.worker_pause?.paused ? `${runtime.worker_pause.task_types?.length ? `${runtime.worker_pause.task_types.length} tipos suspensos` : 'Todos os tipos suspensos'} · ${runtime.worker_pause.paused_until ? `retoma automática em ${timeLabel(runtime.worker_pause.paused_until)}` : 'aguardam liberação manual'}` : 'Suspenda todos os novos claims ou apenas famílias de tarefas; o trabalho em curso termina normalmente.'}</small></div>
            {runtime.worker_pause?.paused && <button type="button" className="agent-runtime-icon-button tone-success" disabled={busy} onClick={() => void resumeWorkers()} aria-label="Retomar Workers" title="Retomar Workers"><Icon name="play" size={14}/></button>}
          </div>
          {!runtime.worker_pause?.paused && <>
            <div className="agent-runtime-pause-controls agent-runtime-worker-policy-controls"><select aria-label="Âmbito da suspensão dos Workers" value={workerPauseScope} disabled={busy} onChange={(event) => setWorkerPauseScope(event.target.value === 'types' ? 'types' : 'all')}><option value="all">Todos os tipos</option><option value="types">Tipos selecionados</option></select><select aria-label="Modo de retoma dos Workers" value={workerPauseMode} disabled={busy} onChange={(event) => setWorkerPauseMode(event.target.value === 'manual' ? 'manual' : 'timed')}><option value="timed">Retoma automática</option><option value="manual">Liberação manual</option></select>{workerPauseMode === 'timed' && <label><input aria-label="Minutos até retoma dos Workers" type="number" min="1" max="10080" step="1" value={workerPauseMinutes} disabled={busy} onChange={(event) => setWorkerPauseMinutes(event.target.value)}/><span>min</span></label>}<button type="button" className="agent-runtime-icon-button tone-warning" disabled={busy} onClick={() => void suspendWorkers()} aria-label="Suspender Workers" title="Suspender Workers"><Icon name="pause" size={14}/></button></div>
            {workerPauseScope === 'types' && <fieldset className="agent-runtime-task-suspension"><legend>Tipos de tarefa a suspender</legend><div className="agent-runtime-task-tree"><div className="agent-runtime-task-tree-root"><span className="agent-runtime-task-tree-node-mark" aria-hidden="true"><Icon name="list" size={13}/></span><span><strong>Task</strong><small>Organize a suspensão por finalidade, sem perder o controlo por tipo.</small></span><em>{workerPauseTaskTypes.length} selecionados</em></div><div className="agent-runtime-task-tree-branches">{workerTaskTypeGroups.map((group) => { const selectedCount = group.tasks.filter(([type]) => workerPauseTaskTypes.includes(type)).length; const allSelected = selectedCount === group.tasks.length; return <section key={group.id} className="agent-runtime-task-tree-group" aria-label={group.label}><header><label><input type="checkbox" aria-label={`Suspender grupo ${group.label}`} checked={allSelected} disabled={busy} onChange={(event) => { const checked = event.currentTarget.checked; const types = group.tasks.map(([type]) => type); setWorkerPauseTaskTypes((current) => { const next = new Set(current); for (const type of types) { if (checked) next.add(type); else next.delete(type) } return [...next] }) }}/><span><strong>{group.label}</strong><small>{group.description}</small></span></label><em>{selectedCount}/{group.tasks.length}</em></header><div>{group.tasks.map(([type, label]) => <label key={type} className="agent-runtime-task-tree-leaf"><input type="checkbox" checked={workerPauseTaskTypes.includes(type)} disabled={busy} onChange={(event) => setWorkerPauseTaskTypes((current) => event.target.checked ? [...current, type] : current.filter((item) => item !== type))}/><span>{label}</span><code>{type}</code></label>)}</div></section> })}</div></div></fieldset>}
          </>}
        </div>
        <div className={`agent-runtime-scale-card agent-runtime-rate-limit-policy agent-runtime-policy-wide${runtime.provider?.paused ? ' is-paused' : ''}`}>
          <div><strong>Suspensão automática por rate limit</strong><small>Após HTTP 429 ou gate estrutural, apenas os Workers entram em cooldown; Supervisores e Translator permanecem ativos.</small>{runtime.provider?.paused && <span className="agent-runtime-inline-status">Rate limit ativo · {runtime.provider.paused_until ? `retoma em ${timeLabel(runtime.provider.paused_until)}` : short(runtime.provider.reason, 'aguarda liberação do provider')}</span>}{runtime.provider?.paused && <button type="button" className="agent-runtime-icon-button tone-success" disabled={busy} onClick={() => void releaseRateLimit()} aria-label="Libertar suspensão por rate limit" title="Libertar suspensão por rate limit agora"><Icon name="play" size={14}/></button>}</div>
          <label className="agent-runtime-number-policy"><input key={runtime.policies.rate_limit_cooldown_minutes} aria-label="Minutos de suspensão automática por rate limit" type="number" min="1" max="60" step="0.5" defaultValue={runtime.policies.rate_limit_cooldown_minutes} disabled={busy} onBlur={(event) => { const minutes = Number(event.currentTarget.value); if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) { event.currentTarget.value = String(runtime.policies.rate_limit_cooldown_minutes); onError?.('Defina a suspensão automática entre 1 e 60 minutos.'); return } void updatePolicies({ rate_limit_cooldown_minutes: minutes }) }}/><span>min</span></label>
        </div>
      </div>
    </section>

    <section className="agent-runtime-policy-section" aria-label="Capacidade dos agentes">
      <header className="agent-runtime-policy-heading">
        <div><span>Capacidade</span><h3>Pool base e limites</h3></div>
        <small>Ajusta a capacidade permanente e os tetos usados pelo crescimento automático.</small>
      </header>
      <div className="agent-runtime-policy-grid">
        <div className="agent-runtime-scale-card"><div><strong>Supervisores</strong><small>Um por chat: abre a conversa, envia e recolhe o bundle, e só liberta o chat quando o pedido termina.</small></div><div className="agent-runtime-stepper"><button disabled={busy || runtime.configured_supervisors <= runtime.limits.min_supervisors} onClick={() => void scaleSupervisors(-1)} aria-label="Diminuir supervisores" title="Diminuir supervisores"><Icon name="minus" size={13}/></button><b>{runtime.configured_supervisors}</b><button disabled={busy || runtime.configured_supervisors >= runtime.limits.max_supervisors} onClick={() => void scaleSupervisors(1)} aria-label="Aumentar supervisores" title="Aumentar supervisores"><Icon name="plus" size={13}/></button></div></div>
        <div className="agent-runtime-scale-card"><div><strong>Workers</strong><small>Base configurada; extras podem ser geridos por Auto scale.</small></div><div className="agent-runtime-stepper"><button disabled={busy || runtime.configured_workers <= runtime.limits.min_workers} onClick={() => void scaleWorkers(-1)} aria-label="Diminuir workers" title="Diminuir workers"><Icon name="minus" size={13}/></button><b>{runtime.configured_workers}</b><button disabled={busy || runtime.configured_workers >= runtime.limits.max_workers} onClick={() => void scaleWorkers(1)} aria-label="Aumentar workers" title="Aumentar workers"><Icon name="plus" size={13}/></button></div></div>
        <div className="agent-runtime-scale-card"><div><strong>Teto Auto scale Supervisores</strong><small>Máximo total de Supervisores que o Auto scale pode atingir; a base manual nunca é reduzida por este teto.</small></div><div className="agent-runtime-stepper"><button disabled={busy || runtime.policies.auto_scale_max_supervisors <= runtime.limits.min_supervisors} onClick={() => void scaleAutoScaleSupervisorCeiling(-1)} aria-label="Diminuir teto Auto scale Supervisores" title="Diminuir teto Auto scale Supervisores"><Icon name="minus" size={13}/></button><b>{runtime.policies.auto_scale_max_supervisors}</b><button disabled={busy || runtime.policies.auto_scale_max_supervisors >= runtime.limits.max_supervisors} onClick={() => void scaleAutoScaleSupervisorCeiling(1)} aria-label="Aumentar teto Auto scale Supervisores" title="Aumentar teto Auto scale Supervisores"><Icon name="plus" size={13}/></button></div></div>
        <div className="agent-runtime-scale-card"><div><strong>Teto Auto scale Workers</strong><small>Máximo total de Workers que o Auto scale pode atingir; a base manual nunca é reduzida por este teto.</small></div><div className="agent-runtime-stepper"><button disabled={busy || runtime.policies.auto_scale_max_workers <= runtime.limits.min_workers} onClick={() => void scaleAutoScaleCeiling(-1)} aria-label="Diminuir teto Auto scale" title="Diminuir teto Auto scale"><Icon name="minus" size={13}/></button><b>{runtime.policies.auto_scale_max_workers}</b><button disabled={busy || runtime.policies.auto_scale_max_workers >= runtime.limits.max_workers} onClick={() => void scaleAutoScaleCeiling(1)} aria-label="Aumentar teto Auto scale" title="Aumentar teto Auto scale"><Icon name="plus" size={13}/></button></div></div>
      </div>
    </section>

    <section className="agent-runtime-policy-section" aria-label="Automação dos Workers">
      <header className="agent-runtime-policy-heading">
        <div><span>Automação</span><h3>Comportamento dos Workers</h3></div>
        <small>Define como o pool cresce e por quanto tempo cada Worker permanece dedicado a um pedido.</small>
      </header>
      <div className="agent-runtime-policy-grid">
        <div className="agent-runtime-scale-card"><div><strong>Auto scale</strong><small>Cria um Worker extra quando chega trabalho executável e todos os Workers ativos estão ocupados, até ao teto configurado.</small></div><button type="button" className="agent-runtime-icon-button agent-runtime-toggle" aria-pressed={runtime.policies.auto_scale} aria-label={runtime.policies.auto_scale ? 'Ativo' : 'Inativo'} title={runtime.policies.auto_scale ? 'Desativar Auto scale' : 'Ativar Auto scale'} disabled={busy} onClick={() => void updatePolicies({ auto_scale: !runtime.policies.auto_scale })}><Icon name="agent" size={14}/></button></div>
        <div className="agent-runtime-scale-card"><div><strong>Keep flowing</strong><small>Globalmente fixa cada Worker ao pedido até existir um bundle válido entregue ao processamento; 429 suspende sem abandonar a tarefa.</small></div><button type="button" className="agent-runtime-icon-button agent-runtime-toggle" aria-pressed={runtime.policies.keep_flowing_global} aria-label={runtime.policies.keep_flowing_global ? 'Global ativo' : 'Global inativo'} title={runtime.policies.keep_flowing_global ? 'Desativar Keep flowing global' : 'Ativar Keep flowing global'} disabled={busy} onClick={() => void updatePolicies({ keep_flowing_global: !runtime.policies.keep_flowing_global })}><Icon name="refresh" size={14}/></button></div>
      </div>
    </section>
  </>
}
