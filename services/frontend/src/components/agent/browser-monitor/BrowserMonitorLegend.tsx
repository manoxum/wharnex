import { stateLegend } from './browserMonitorModel'

export function BrowserMonitorLegend() {
  return <details className="shrink-0 border-b border-whx-border-soft bg-whx-surface px-4 py-2 text-whx-caption text-whx-faint">
    <summary className="cursor-pointer focus-visible:outline-whx-accent">Legenda dos estados</summary>
    <div className="flex flex-wrap gap-x-5 gap-y-3 pb-1 pt-3" aria-label="Legenda dos estados">
      {stateLegend.map((state) => <span key={state.key} className="inline-flex items-center gap-2 whitespace-nowrap text-whx-soft"><span className={`size-2 rounded-full ${state.dot}`} aria-hidden="true"/>{state.label}</span>)}
    </div>
  </details>
}
