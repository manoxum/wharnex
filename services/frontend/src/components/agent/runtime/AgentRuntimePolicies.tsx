import { confirmDialog } from '../../../lib/desktop/bridge/appDialog'
import { Icon } from '../../presentation/chrome/Icon'
import { short, timeLabel, useAgentRuntimePolicyActions } from './agentRuntimePolicyActions'
import { AgentTaskPolicies } from './task-policies/AgentTaskPolicies'

const confirmCooldownRelease = (kind: 'rate_limit' | 'upload_limit') => kind === 'upload_limit'
  ? confirmDialog({
    title: 'Libertar limite de upload?',
    message: 'Todos os tipos que enviam ficheiros voltam a tentar upload já. Use depois de trocar de conta ChatGPT; se a conta ainda estiver limitada, o limite volta a ser detetado após dois uploads sem arranque.',
    tone: 'warning', confirmLabel: 'Libertar agora', cancelLabel: 'Manter cooldown',
  })
  : confirmRelease()

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
    scaleSupervisors, scaleWorkers, updatePolicies, scaleAutoScaleCeiling, scaleAutoScaleSupervisorCeiling,
    suspendWorkers, releaseRateLimit, releaseRateLimitConfirmed, resumeWorkers,
  } = useAgentRuntimePolicyActions({ runtime, onRuntime, onError, confirmRelease })

  return <>
    <AgentTaskPolicies confirm={confirmCooldownRelease} releaseRateLimit={releaseRateLimitConfirmed} onError={onError}/>

    <section className="agent-runtime-policy-section" aria-label="Proteção do provedor">
      <header className="agent-runtime-policy-heading">
        <div><span>Proteção do provedor</span><h3>Retoma e rate limit</h3></div>
        <small>Controla quando os Workers param, retomam e voltam a pressionar o ChatGPT.</small>
      </header>
      <div className="agent-runtime-policy-grid">
        <div className={`agent-runtime-worker-policy agent-runtime-policy-wide${runtime.worker_pause?.paused ? ' is-paused' : ''}`}>
          <div className="agent-runtime-worker-policy-heading">
            <div className="agent-runtime-pause-copy"><span className="agent-runtime-policy-chip">Workers</span><strong>Pool de Workers inteiro</strong><small>{runtime.worker_pause?.paused ? `Pool de Workers suspenso · ${runtime.worker_pause.paused_until ? `retoma automática às ${timeLabel(runtime.worker_pause.paused_until)}` : 'aguarda retoma manual'}` : 'Pára todos os novos claims dos Workers persistentes; para um tipo de tarefa, use as políticas por tipo acima.'}</small></div>
            {runtime.worker_pause?.paused && <button type="button" className="agent-runtime-icon-button tone-success" disabled={busy} onClick={() => void resumeWorkers()} aria-label="Retomar Workers" title="Retomar Workers"><Icon name="play" size={14}/></button>}
          </div>
          {!runtime.worker_pause?.paused && <>
            <div className="agent-runtime-pause-controls agent-runtime-worker-policy-controls"><select aria-label="Modo de retoma dos Workers" value={workerPauseMode} disabled={busy} onChange={(event) => setWorkerPauseMode(event.target.value === 'manual' ? 'manual' : 'timed')}><option value="timed">Retoma automática</option><option value="manual">Liberação manual</option></select>{workerPauseMode === 'timed' && <label><input aria-label="Minutos até retoma dos Workers" type="number" min="1" max="10080" step="1" value={workerPauseMinutes} disabled={busy} onChange={(event) => setWorkerPauseMinutes(event.target.value)}/><span>min</span></label>}<button type="button" className="agent-runtime-icon-button tone-warning" disabled={busy} onClick={() => void suspendWorkers()} aria-label="Suspender Workers" title="Suspender Workers"><Icon name="pause" size={14}/></button></div>
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
