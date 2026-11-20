import { translate as uiText } from '../../../lib/workspace/localization'
export function Status({ status }: { status: string }) {
  const tone = status === 'READY' || status === 'COMPLETE' ? 'text-[var(--theme-success)]'
    : status === 'FAILED' ? 'text-[var(--theme-danger)]'
      : status === 'WAITING' ? 'text-[var(--theme-warning)]'
        : status === 'DOING' ? 'text-[var(--theme-running)]'
          : status === 'REVIEW' ? 'text-whx-soft' : 'text-whx-faint'
  return <span className={`inline-flex min-h-5 w-max items-center font-mono text-sm font-medium leading-none ${tone}`}>{status === 'WAITING' ? uiText("Espera") : status}</span>
}
