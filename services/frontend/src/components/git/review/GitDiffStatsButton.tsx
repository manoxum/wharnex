export function GitDiffStatsButton({ additions, deletions, disabled, label, title, onClick }: {
  additions: number
  deletions: number
  disabled?: boolean
  label: string
  title?: string
  onClick: () => void
}) {
  return <button type="button" data-git-diff-stats className="inline-flex min-h-7 min-w-14 self-center items-center justify-end gap-1 rounded-md border border-transparent bg-transparent px-1 font-mono !text-[calc(7.5px*var(--ui-font-scale))] !font-medium !leading-none tabular-nums text-whx-faint transition-colors hover:border-whx-border-soft hover:bg-whx-surface hover:text-whx-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whx-accent disabled:cursor-default disabled:opacity-40" disabled={disabled} title={title} aria-label={label} onClick={onClick}>
    <b className="not-italic font-medium text-whx-success">+{additions}</b><i className="not-italic font-medium text-whx-danger">−{deletions}</i>
  </button>
}
