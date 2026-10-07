import { useState, type ReactNode } from 'react'
import { short, timeLabel, useAgentRuntimePolicyActions } from '../runtime/agentRuntimePolicyActions'
import { AgentTaskPolicies } from '../runtime/task-policies/AgentTaskPolicies'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="border-b border-white/[.07] px-5 py-4" aria-label={title}>
    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</h3>
    {children}
  </section>
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 py-2.5">
    <div className="min-w-0"><div className="text-[13px] font-medium leading-5 text-slate-100">{label}</div>{hint ? <div className="text-[11px] leading-4 text-slate-500">{hint}</div> : null}</div>
    <div className="shrink-0">{children}</div>
  </div>
}

function Stepper({ label, value, onChange, min, max, disabled }: { label: string; value: number; onChange: (delta: number) => void; min: number; max: number; disabled: boolean }) {
  const step = 'grid h-7 w-7 place-items-center border-0 bg-transparent! p-0 text-[15px]! leading-none! text-slate-400 transition hover:text-cyan-200 disabled:opacity-30'
  return <div className="inline-flex items-center rounded-lg border border-white/[.12] bg-white/[.02]" role="group" aria-label={label}>
    <button type="button" className={step} aria-label={`Diminuir ${label}`} disabled={disabled || value <= min} onClick={() => onChange(-1)}>−</button>
    <span className="w-7 text-center font-mono text-[12px] text-slate-100" aria-live="polite">{value}</span>
    <button type="button" className={step} aria-label={`Aumentar ${label}`} disabled={disabled || value >= max} onClick={() => onChange(1)}>+</button>
  </div>
}

function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
    className={`relative h-5 w-9 rounded-full border-0 p-0 transition ${checked ? 'bg-cyan-400/80!' : 'bg-white/[.14]!'}`}>
    <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} aria-hidden="true" />
  </button>
}

function Segmented<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; disabled: boolean; onChange: (value: T) => void }) {
  return <div className="inline-flex rounded-lg border border-white/[.1] bg-white/[.03] p-0.5" role="radiogroup" aria-label={label}>
    {options.map(([option, text]) => <button key={option} type="button" role="radio" aria-checked={value === option} disabled={disabled} onClick={() => onChange(option)}
      className={`rounded-md border-0 px-2.5 py-1 text-[11px]! font-medium! leading-4! transition ${value === option ? 'bg-cyan-400/15! text-cyan-200' : 'bg-transparent! text-slate-400 hover:text-slate-200'}`}>{text}</button>)}
  </div>
}

const actionButton = 'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px]! font-medium! leading-none! transition disabled:opacity-40'
const tone = {
  warn: `${actionButton} border-amber-400/30 bg-amber-400/[.08]! text-amber-200 hover:bg-amber-400/[.15]!`,
  ok: `${actionButton} border-emerald-400/30 bg-emerald-400/[.08]! text-emerald-200 hover:bg-emerald-400/[.15]!`,
  quiet: `${actionButton} border-white/[.12] bg-transparent! text-slate-300 hover:text-slate-100`,
}
// Global input rules are unlayered, so every visual property is forced here.
const numberInput = 'h-7! w-16 rounded-md! border! border-white/[.12]! bg-[#0a111b]! px-2! py-0! text-right font-mono! text-[12px]! text-slate-100! outline-none focus:border-cyan-400/50!'

function Status({ tone: statusTone, title, detail, children }: { tone: 'ok' | 'warn'; title: string; detail: string; children?: ReactNode }) {
  return <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 ${statusTone === 'warn' ? 'border-amber-400/20 bg-amber-400/[.05]' : 'border-white/[.07] bg-white/[.02]'}`}>
    <div className="flex min-w-0 gap-2.5"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusTone === 'warn' ? 'bg-amber-400' : 'bg-emerald-400'}`} aria-hidden="true" /><div className="min-w-0"><div className="text-[12px] font-medium text-slate-100">{title}</div><div className="text-[11px] leading-4 text-slate-400">{detail}</div></div></div>
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

  return <aside className="flex min-h-0 flex-col border-l border-white/[.07] bg-[#0e1723]" aria-label="Políticas das instâncias">
    <header className="flex items-center justify-between gap-3 border-b border-white/[.07] px-5 py-4">
      <div><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Runtime</div><h2 className="text-[15px] font-semibold text-slate-100">Políticas</h2></div>
      <button type="button" aria-label="Fechar políticas" title="Fechar políticas" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md border border-white/[.12] bg-transparent! p-0 text-slate-400 transition hover:border-cyan-400/40 hover:text-cyan-200">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Section title="Estado">
        <div className="mt-2 space-y-2">
          {provider?.paused
            ? <Status tone="warn" title="Rate limit ativo" detail={provider.paused_until ? `Workers em cooldown até ${timeLabel(provider.paused_until)}` : short(provider.reason, 'Aguarda liberação do provider')}>
              {confirmingRelease
                ? <><button type="button" className={tone.warn} disabled={busy} onClick={() => { setConfirmingRelease(false); void releaseRateLimit() }}>Confirmar</button><button type="button" className={tone.quiet} onClick={() => setConfirmingRelease(false)}>Cancelar</button></>
                : <button type="button" className={tone.quiet} disabled={busy} title="Os Workers voltam a enviar pedidos antes do fim do cooldown" onClick={() => setConfirmingRelease(true)}>Libertar</button>}
            </Status>
            : <Status tone="ok" title="Provider sem limitação" detail="Nenhum cooldown de rate limit ativo." />}
          {workerPause?.paused
            ? <Status tone="warn" title="Pool de Workers suspenso" detail={workerPause.paused_until ? `Retoma às ${timeLabel(workerPause.paused_until)}` : 'Aguarda retoma manual'}>
              <button type="button" className={tone.ok} disabled={busy} onClick={() => void resumeWorkers()}>Retomar</button>
            </Status>
            : <Status tone="ok" title="Workers ativos" detail="Novas tarefas são reclamadas normalmente." />}
        </div>
      </Section>

      <div className="border-b border-white/[.07] px-5 py-4"><AgentTaskPolicies releaseRateLimit={releaseRateLimitConfirmed} onError={onError}/></div>

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
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500"><input key={policies.rate_limit_cooldown_minutes} className={numberInput} aria-label="Minutos de suspensão automática por rate limit" type="number" min="1" max="60" step="0.5" defaultValue={policies.rate_limit_cooldown_minutes} disabled={busy} onBlur={(event) => { const minutes = Number(event.currentTarget.value); if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) { event.currentTarget.value = String(policies.rate_limit_cooldown_minutes); onError?.('Defina a suspensão automática entre 1 e 60 minutos.'); return } if (minutes !== policies.rate_limit_cooldown_minutes) void updatePolicies({ rate_limit_cooldown_minutes: minutes }) }} />min</label>
        </Row>
        {!workerPause?.paused ? <div className="mt-1 rounded-lg border border-white/[.07] bg-white/[.02] p-3">
          <div className="text-[13px] font-medium text-slate-100">Suspender o pool de Workers inteiro</div>
          <div className="mb-3 text-[11px] leading-4 text-slate-500">O trabalho em curso termina; só novos claims param. Para um tipo de tarefa, use as políticas por tipo.</div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Retoma" value={workerPauseMode} disabled={busy} onChange={setWorkerPauseMode} options={[['timed', 'Automática'], ['manual', 'Manual']] as const} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            {workerPauseMode === 'timed' ? <label className="flex items-center gap-1.5 text-[11px] text-slate-500"><input className={numberInput} aria-label="Minutos até retoma dos Workers" type="number" min="1" max="10080" step="1" value={workerPauseMinutes} disabled={busy} onChange={(event) => setWorkerPauseMinutes(event.target.value)} />min</label> : <span className="text-[11px] text-slate-500">Até retomar manualmente</span>}
            <button type="button" className={tone.warn} disabled={busy} onClick={() => void suspendWorkers()}>Suspender</button>
          </div>
        </div> : null}
      </Section>
    </div>
  </aside>
}
