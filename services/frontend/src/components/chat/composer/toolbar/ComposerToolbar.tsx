import type { ReactNode } from 'react'
import { ControlPopover } from '../../../presentation/workbench'

export function ComposerToolbar({ attachments, context, safety, configuration, workflow, activity, send, hint }: {
  attachments: ReactNode; context?: ReactNode | ((close: () => void) => ReactNode); safety?: ReactNode; configuration?: ReactNode
  workflow?: ReactNode; activity?: ReactNode; send: ReactNode; hint: ReactNode
}) {
  return <div className="composer-footer grid min-w-0 shrink-0 gap-2 border-t border-whx-border-soft px-3 pb-3 pt-2">
    {configuration && <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Configuração da conversa">{configuration}</div>}
    <div className="flex min-w-0 items-end gap-3">
      <div className="composer-action-row flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="group" aria-label="Opções da próxima iteração">
        {attachments}
        {context && <ControlPopover label="Contexto e ferramentas" icon="more-horizontal">{(close) => <div className="grid min-w-0 gap-2">{typeof context === 'function' ? context(close) : context}</div>}</ControlPopover>}
        {safety && <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Segurança da execução">{safety}</div>}
        {workflow && <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Execução e automação">{workflow}</div>}
        {activity}
      </div>
      <div className="shrink-0 [&>button]:!static [&>button]:!m-0 [&>button]:!grid [&>button]:!size-9 [&>button]:!min-w-9 [&>button]:!place-items-center [&>button]:!rounded-lg [&>button]:!border-0 [&>button]:!bg-whx-accent [&>button]:!p-0 [&>button]:!text-[color:var(--theme-bg)] [&>button]:!shadow-none [&>button]:focus-visible:!outline-whx-accent [&>button]:disabled:!opacity-40">{send}</div>
    </div>
    <div className="text-whx-caption leading-relaxed text-whx-faint">{hint}</div>
  </div>
}
