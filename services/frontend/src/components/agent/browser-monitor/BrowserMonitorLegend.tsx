import { stateLegend } from './browserMonitorModel'

export function BrowserMonitorLegend() {
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/[.07] bg-[#1b1d22] px-7 py-2.5" aria-label="Legenda dos estados">
    <span className="mr-1 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">Estados</span>
    {stateLegend.map((state) => <span key={state.key} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-300"><span className={`h-2.5 w-2.5 rounded-full ${state.dot}`} aria-hidden="true" />{state.label}</span>)}
  </div>
}
