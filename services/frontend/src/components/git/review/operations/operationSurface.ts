import type { GitOperationPhase } from './operationTypes'

export function gitOperationSurface(phase: GitOperationPhase) {
  if (phase === 'selecting') return 'selecting flex w-[min(720px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] min-w-0 flex-col overflow-hidden rounded-xl border border-whx-border bg-whx-surface'
  if (phase === 'reviewing') return 'isolate flex h-[min(86vh,900px)] w-[min(96vw,1680px)] min-w-0 flex-col overflow-hidden rounded-xl border border-whx-border bg-whx-bg'
  return 'isolate grid w-[min(660px,calc(100vw-32px))] max-h-[calc(100vh-32px)] grid-cols-[48px_minmax(0,1fr)] gap-x-4 gap-y-4 overflow-hidden rounded-2xl border border-whx-border bg-whx-elevated p-5 text-whx-text shadow-[0_28px_80px_var(--theme-shadow)] max-[560px]:w-[calc(100vw-20px)] max-[560px]:grid-cols-[44px_minmax(0,1fr)] max-[560px]:gap-x-3 max-[560px]:gap-y-3 max-[560px]:p-4'
}
