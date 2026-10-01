type Panel = 'lista de instâncias' | 'painel de detalhes'

export function BrowserMonitorPanelToggle({ panel, expanded, onToggle }: { panel: Panel; expanded: boolean; onToggle: () => void }) {
  const label = `${expanded ? 'Recolher' : 'Expandir'} ${panel}`
  return <button type="button" aria-label={label} title={label} aria-expanded={expanded} onClick={onToggle} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/[.12] bg-transparent! text-slate-400 transition hover:border-cyan-400/40 hover:bg-cyan-400/[.08]! hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-cyan-300">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  </button>
}
