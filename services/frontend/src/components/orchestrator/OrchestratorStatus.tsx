export function Status({ status }: { status: string }) {
  const tone = status === 'READY' ? 'border-[color-mix(in_srgb,#5e9d67_38%,var(--theme-border))] text-[#6ca574]'
    : status === 'WAITING' || status === 'DOING' ? 'border-[color-mix(in_srgb,#bc8a36_42%,var(--theme-border))] text-[#c28c36]'
      : status === 'REVIEW' ? 'border-[color-mix(in_srgb,#7389b8_42%,var(--theme-border))] text-[#8094c0]'
        : status === 'COMPLETE' ? 'border-[color-mix(in_srgb,#659673_38%,var(--theme-border))] text-[#6a9a75]'
          : 'border-[var(--theme-border-soft)] text-[var(--theme-text-muted)]'
  return <span className={`inline-flex min-h-5 w-max items-center rounded-full border bg-[var(--theme-subtle)] px-1.5 font-[var(--mono-font-family)] text-[calc(6.7px*var(--ui-font-scale))] font-bold leading-none tracking-[0.025em] ${tone}`}>{status === 'WAITING' ? 'Espera' : status}</span>
}
