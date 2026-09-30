export function Status({ status }: { status: string }) {
  const tone = status === 'READY' ? 'border-[var(--theme-success)] text-[var(--theme-success)]'
    : status === 'FAILED' ? 'border-[var(--theme-danger)] text-[var(--theme-danger)]'
    : status === 'WAITING' || status === 'DOING' ? 'border-[var(--theme-warning)] text-[var(--theme-warning)]'
      : status === 'REVIEW' ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]'
        : status === 'COMPLETE' ? 'border-[var(--theme-success)] text-[var(--theme-success)]'
          : 'border-[var(--theme-border-soft)] text-[var(--theme-text-muted)]'
  return <span className={`inline-flex min-h-5 w-max items-center rounded-full border bg-[var(--theme-subtle)] px-2 font-mono text-sm font-bold leading-none tracking-[0.025em] ${tone}`}>{status === 'WAITING' ? 'Espera' : status}</span>
}
