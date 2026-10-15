import type { CodexLimitWindow, CodexStatus, CodexThread } from '../../../lib/codex'
import { Icon } from '../../presentation/chrome/Icon'

function UsageWindow({ label, window }: { label: string; window: CodexLimitWindow | null | undefined }) {
  const percent = window ? Math.min(100, Math.max(0, window.usedPercent)) : 0
  return <section className="rounded-xl border border-whx-border-soft bg-whx-muted/30 p-4">
    <div className="flex items-center justify-between gap-3"><h4 className="m-0 text-[calc(11px*var(--ui-font-scale))] font-medium text-whx-soft">{label}</h4><strong className="font-mono text-xl font-medium tabular-nums">{window ? `${Math.round(percent)}%` : '—'}</strong></div>
    <div role="progressbar" aria-label={label} aria-valuenow={window ? percent : undefined} aria-valuetext={window ? `${Math.round(percent)}% utilizado` : 'Indisponível'} aria-valuemin={0} aria-valuemax={100} className="mb-3 mt-4 h-1.5 overflow-hidden rounded-full bg-whx-border-soft"><div className="h-full rounded-full bg-whx-accent motion-safe:transition-[width]" style={{ width: `${percent}%` }}/></div>
    <p className="m-0 text-[calc(10px*var(--ui-font-scale))] leading-5 text-whx-faint">{window ? `Renova ${new Date(window.resetsAt * 1000).toLocaleString()} · janela de ${window.windowDurationMins >= 1440 ? `${Math.round(window.windowDurationMins / 1440)} dias` : `${window.windowDurationMins} min`}` : 'Limite não disponibilizado pela conta.'}</p>
  </section>
}
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString()
function TokenMetrics({ label, entries }: { label: string; entries: Array<[string, number | null | undefined]> }) {
  return <section className="mt-6">
    <h4 className="m-0 mb-3 text-[calc(10px*var(--ui-font-scale))] font-medium uppercase tracking-widest text-whx-faint">{label}</h4>
    <dl className="m-0 grid grid-cols-2 gap-x-5 gap-y-4">{entries.map(([title, value]) => <div key={title} className="min-w-0 border-t border-whx-border-soft pt-3"><dt className="text-[calc(10px*var(--ui-font-scale))] leading-5 text-whx-faint">{title}</dt><dd className="m-0 mt-1 break-all font-mono text-lg tabular-nums text-whx-text">{number(value)}</dd></div>)}</dl>
  </section>
}
export function CodexUsage({ status, thread }: { status?: CodexStatus; thread?: CodexThread }) {
  const tokens = thread?.tokenUsage?.total
  return <section className="mx-auto max-w-3xl p-4" aria-label="Consumo Codex">
    <div className="mb-5"><h3 className="m-0 text-lg font-semibold tracking-tight">Utilização e limites</h3><p className="mb-0 mt-2 text-[calc(11px*var(--ui-font-scale))] leading-6 text-whx-faint">Acompanhe a disponibilidade da conta e os tokens da conversa atual.</p></div>
    <div className="flex flex-col gap-3"><UsageWindow label="Uso da janela principal" window={status?.rateLimits?.primary}/><UsageWindow label="Uso da janela secundária" window={status?.rateLimits?.secondary}/></div>
    <TokenMetrics label="Conversa atual" entries={[
      ['Tokens desta conversa', tokens?.totalTokens], ['Entrada em cache', tokens?.cachedInputTokens],
      ['Tokens de entrada', tokens?.inputTokens], ['Tokens de saída', tokens?.outputTokens],
    ]}/>
    <TokenMetrics label="Conta" entries={[
      ['Total da conta', status?.usage?.lifetimeTokens], ['Pico diário', status?.usage?.peakDailyTokens],
    ]}/>
    <p className="mb-0 mt-6 flex items-start gap-2 rounded-lg bg-whx-muted/50 p-3 text-[calc(10px*var(--ui-font-scale))] leading-5 text-whx-faint"><span className="mt-0.5 shrink-0"><Icon name="info" size={14}/></span><span>Valores reportados pelo Codex. Limites de utilização e tokens não representam um preço em dinheiro. Métricas indisponíveis aparecem como —.</span></p>
  </section>
}
