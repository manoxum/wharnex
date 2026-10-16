import { useState, type ReactNode } from 'react'
import { short, timeLabel, useAgentRuntimePolicyActions } from '../runtime/agentRuntimePolicyActions'
import { Button, IconButton, NumberStepper as Stepper, Switch, fieldClass, PanelHeader } from '../../presentation/workbench'
import { AgentTaskPolicies } from '../runtime/task-policies/AgentTaskPolicies'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="border-b border-whx-border-soft px-5 py-4" aria-label={title}>
    <h3 className="mb-1 text-whx-caption font-semibold uppercase tracking-[0.16em] text-whx-faint">{title}</h3>
    {children}
  </section>
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 py-3">
    <div className="min-w-0"><div className="text-whx-label font-medium leading-5 text-whx-text">{label}</div>{hint ? <div className="text-whx-caption leading-relaxed text-whx-faint">{hint}</div> : null}</div>
    <div className="shrink-0">{children}</div>
  </div>
}

function Segmented<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; disabled: boolean; onChange: (value: T) => void }) {
  return <div className="inline-flex rounded-lg border border-whx-border-soft bg-whx-muted p-0.5" role="radiogroup" aria-label={label}>
    {options.map(([option, text]) => <button key={option} type="button" role="radio" aria-checked={value === option} disabled={disabled} onClick={() => onChange(option)}
      className={`rounded-md border-0 px-2.5 py-1 text-whx-caption! font-medium! leading-relaxed! transition ${value === option ? 'bg-whx-hover! text-whx-text' : 'bg-transparent! text-whx-faint hover:text-whx-text'}`}>{text}</button>)}
  </div>
}

const numberInput = `${fieldClass} !h-8 !w-20 !py-1 text-right !font-mono`

function Status({ tone: statusTone, title, detail, children }: { tone: 'ok' | 'warn'; title: string; detail: string; children?: ReactNode }) {
  return <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 ${statusTone === 'warn' ? 'border-whx-border bg-whx-surface' : 'border-whx-border-soft bg-whx-muted'}`}>
    <div className="flex min-w-0 gap-2.5"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusTone === 'warn' ? 'bg-whx-warning' : 'bg-whx-success'}`} aria-hidden="true" /><div className="min-w-0"><div className="text-whx-label font-medium text-whx-text">{title}</div><div className="text-whx-caption leading-relaxed text-whx-faint">{detail}</div></div></div>
    {children ? <div className="flex shrink-0 gap-1.5">{children}</div> : null}
  </div>
}

// The browser monitor's presentation of the Agent runtime policies. It sits in
// a column beside the real browser, so every confirmation is inline: a modal
// would open underneath the native browser view.
export function BrowserMonitorPolicies({ runtime, onRuntime, onError, onClose }: {
  runtime: DesktopAgentRuntimeState
  onRuntime: (runtime: DesktopAgentRuntimeState) => void
  onError?: (message: string) => void
  onClose: () => void
}) {
  const [confirmingRelease, setConfirmingRelease] = useState(false)
  const {
    busy, workerPauseMode, setWorkerPauseMode, workerPauseMinutes, setWorkerPauseMinutes,
    scaleSupervisors, scaleWorkers, updatePolicies, scaleAutoScaleCeiling, scaleAutoScaleSupervisorCeiling,
    suspendWorkers, releaseRateLimit, releaseRateLimitConfirmed, resumeWorkers,
  } = useAgentRuntimePolicyActions({ runtime, onRuntime, onError, confirmRelease: () => true })
  const { policies, limits, provider, worker_pause: workerPause } = runtime

  return <aside className="flex min-h-0 min-w-0 flex-col border-l border-whx-border-soft bg-whx-surface" aria-label="Políticas das instâncias">
    <PanelHeader title="Políticas" description="Capacidade e proteção das instâncias." icon="settings" actions={<IconButton label="Fechar políticas" icon="close" onClick={onClose}/>}/>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Section title="Estado">
        <div className="mt-2 space-y-2">
          {provider?.paused
            ? <Status tone="warn" title="Rate limit ativo" detail={provider.paused_until ? `Workers em cooldown até ${timeLabel(provider.paused_until)}` : short(provider.reason, 'Aguarda liberação do provider')}>
              {confirmingRelease
                ? <><Button disabled={busy} onClick={() => { setConfirmingRelease(false); void releaseRateLimit() }}>Confirmar</Button><Button onClick={() => setConfirmingRelease(false)}>Cancelar</Button></>
                : <Button disabled={busy} title="Os Workers voltam a enviar pedidos antes do fim do cooldown" onClick={() => setConfirmingRelease(true)}>Libertar</Button>}
            </Status>
            : <Status tone="ok" title="Provider sem limitação" detail="Nenhum cooldown de rate limit ativo." />}
          {workerPause?.paused
            ? <Status tone="warn" title="Pool de Workers suspenso" detail={workerPause.paused_until ? `Retoma às ${timeLabel(workerPause.paused_until)}` : 'Aguarda retoma manual'}>
              <Button disabled={busy} onClick={() => void resumeWorkers()}>Retomar</Button>
            </Status>
            : <Status tone="ok" title="Workers ativos" detail="Novas tarefas são reclamadas normalmente." />}
        </div>
      </Section>

      <div className="border-b border-whx-border-soft px-5 py-4"><AgentTaskPolicies releaseRateLimit={releaseRateLimitConfirmed} onError={onError}/></div>

      <Section title="Capacidade">
        <Row label="Supervisores" hint="Um por chat em curso."><Stepper label="supervisores" value={runtime.configured_supervisors} min={limits.min_supervisors} max={limits.max_supervisors} disabled={busy} onChange={(delta) => void scaleSupervisors(delta)} /></Row>
        <Row label="Workers" hint="Base permanente do pool."><Stepper label="workers" value={runtime.configured_workers} min={limits.min_workers} max={limits.max_workers} disabled={busy} onChange={(delta) => void scaleWorkers(delta)} /></Row>
        <Row label="Teto de Supervisores" hint="Máximo com Auto scale."><Stepper label="teto de Supervisores" value={policies.auto_scale_max_supervisors} min={limits.min_supervisors} max={limits.max_supervisors} disabled={busy} onChange={(delta) => void scaleAutoScaleSupervisorCeiling(delta)} /></Row>
        <Row label="Teto de Workers" hint="Máximo com Auto scale."><Stepper label="teto de Workers" value={policies.auto_scale_max_workers} min={limits.min_workers} max={limits.max_workers} disabled={busy} onChange={(delta) => void scaleAutoScaleCeiling(delta)} /></Row>
      </Section>

      <Section title="Automação">
        <Row label="Auto scale" hint="Cria Workers extra quando todos estão ocupados."><Switch label="Auto scale" checked={policies.auto_scale} disabled={busy} onChange={() => void updatePolicies({ auto_scale: !policies.auto_scale })} /></Row>
        <Row label="Keep flowing global" hint="Mantém cada Worker no pedido até ao bundle válido."><Switch label="Keep flowing global" checked={policies.keep_flowing_global} disabled={busy} onChange={() => void updatePolicies({ keep_flowing_global: !policies.keep_flowing_global })} /></Row>
      </Section>

      <Section title="Proteção">
        <Row label="Cooldown por rate limit" hint="Só os Workers param; Supervisores continuam.">
          <label className="flex items-center gap-1.5 text-whx-caption text-whx-faint"><input key={policies.rate_limit_cooldown_minutes} className={numberInput} aria-label="Minutos de suspensão automática por rate limit" type="number" min="1" max="60" step="0.5" defaultValue={policies.rate_limit_cooldown_minutes} disabled={busy} onBlur={(event) => { const minutes = Number(event.currentTarget.value); if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) { event.currentTarget.value = String(policies.rate_limit_cooldown_minutes); onError?.('Defina a suspensão automática entre 1 e 60 minutos.'); return } if (minutes !== policies.rate_limit_cooldown_minutes) void updatePolicies({ rate_limit_cooldown_minutes: minutes }) }} />min</label>
        </Row>
        {!workerPause?.paused ? <div className="mt-1 rounded-lg border border-whx-border-soft bg-whx-muted p-3">
          <div className="text-whx-label font-medium text-whx-text">Suspender o pool de Workers inteiro</div>
          <div className="mb-3 text-whx-caption leading-relaxed text-whx-faint">O trabalho em curso termina; só novos claims param. Para um tipo de tarefa, use as políticas por tipo.</div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Retoma" value={workerPauseMode} disabled={busy} onChange={setWorkerPauseMode} options={[['timed', 'Automática'], ['manual', 'Manual']] as const} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            {workerPauseMode === 'timed' ? <label className="flex items-center gap-1.5 text-whx-caption text-whx-faint"><input className={numberInput} aria-label="Minutos até retoma dos Workers" type="number" min="1" max="10080" step="1" value={workerPauseMinutes} disabled={busy} onChange={(event) => setWorkerPauseMinutes(event.target.value)} />min</label> : <span className="text-whx-caption text-whx-faint">Até retomar manualmente</span>}
            <Button disabled={busy} onClick={() => void suspendWorkers()}>Suspender</Button>
          </div>
        </div> : null}
      </Section>
    </div>
  </aside>
}
