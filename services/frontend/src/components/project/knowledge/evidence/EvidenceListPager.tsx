const PAGE_SIZE = 100

function nextEvidencePageSize(shown: number, total: number) {
  return Math.min(PAGE_SIZE, Math.max(0, total - shown))
}

export function EvidenceListPager({ shown, total, label, onShowMore }: {
  shown: number
  total: number
  label: string
  onShowMore: () => void
}) {
  const next = nextEvidencePageSize(shown, total)
  return <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-2 text-sm text-whx-faint">
    <span role="status" aria-live="polite">A mostrar {shown} de {total} {label}</span>
    {next > 0 && <button type="button" className="rounded-lg border border-whx-border bg-whx-elevated px-3 py-2 font-semibold text-whx-soft transition hover:bg-whx-hover hover:text-whx-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whx-accent" onClick={onShowMore}>Mostrar mais {next} {label}</button>}
  </div>
}
