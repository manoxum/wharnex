import { translate as uiText } from '../../../../lib/workspace/localization'
import type { ReactNode } from 'react'
import { ControlPopover } from '../../../presentation/workbench'

export function ComposerToolbar({ attachments, context, safety, configuration, workflow, activity, send, hint }: {
  attachments: ReactNode; context?: ReactNode | ((close: () => void) => ReactNode); safety?: ReactNode; configuration?: ReactNode
  workflow?: ReactNode; activity?: ReactNode; send: ReactNode; hint: ReactNode
}) {
  return <div className="composer-footer grid min-w-0 shrink-0 gap-1.5 border-t border-whx-border-soft px-2.5 pb-2 pt-1.5">
    {configuration && <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0" role="group" aria-label={uiText("Configuração da conversa")} tabIndex={0}>{configuration}</div>}
    <div className="flex min-w-0 items-center gap-2">
      <div className="composer-action-row flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0" role="group" aria-label={uiText("Opções da próxima iteração")} tabIndex={0}>
        {attachments}
        {context && <ControlPopover label={uiText("Contexto e ferramentas")} icon="more-horizontal">{(close) => <div className="grid min-w-0 gap-2">{typeof context === 'function' ? context(close) : context}</div>}</ControlPopover>}
        {safety && <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label={uiText("Segurança da execução")}>{safety}</div>}
        {workflow && <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label={uiText("Execução e automação")}>{workflow}</div>}
        {activity}
      </div>
      <div className="shrink-0 [&>button]:!static [&>button]:!m-0 [&>button]:!grid [&>button]:!size-8 [&>button]:!min-w-8 [&>button]:!place-items-center [&>button]:!rounded-md [&>button]:!border-0 [&>button]:!bg-whx-accent [&>button]:!p-0 [&>button]:!text-[color:var(--theme-bg)] [&>button]:!shadow-none [&>button]:focus-visible:!outline-whx-accent [&>button]:disabled:!opacity-40">{send}</div>
    </div>
    <div className="text-whx-caption leading-relaxed text-whx-faint">{hint}</div>
  </div>
}
