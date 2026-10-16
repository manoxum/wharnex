import { Button, ControlPopover, IconButton } from '../../../presentation/workbench'

export type LayoutControlsProps = {
  leftOpen: boolean; rightOpen: boolean; terminalOpen: boolean; focusMode: boolean
  onLeft: () => void; onRight: () => void; onTerminal: () => void; onFocus: () => void; onRestore: () => void
}
export function LayoutControls(props: LayoutControlsProps) {
  return <div className="ml-auto flex shrink-0 items-center gap-0.5 [&>button[aria-label]]:!size-7 [&>button[aria-label]]:!min-h-7" role="group" aria-label="Disposição do workbench">
    {props.focusMode && <Button tone="quiet" icon="workspace" onClick={props.onFocus}>Sair da concentração</Button>}
    <IconButton label="Alternar painel esquerdo" icon="folder" aria-pressed={props.leftOpen && !props.focusMode} onClick={props.onLeft}/>
    <IconButton label="Alternar terminal" icon="terminal" aria-pressed={props.terminalOpen && !props.focusMode} onClick={props.onTerminal}/>
    <IconButton label="Alternar painel direito" icon="list" aria-pressed={props.rightOpen && !props.focusMode} onClick={props.onRight}/>
    <ControlPopover label="Organizar espaço de trabalho" icon="workspace">{(close) => <>
      <Button icon="monitor" onClick={() => { props.onFocus(); close() }}>{props.focusMode ? 'Sair do modo de concentração' : 'Modo de concentração'}</Button>
      <Button icon="refresh" onClick={() => { props.onRestore(); close() }}>Restaurar layout padrão</Button>
      <p className="!m-0 !text-whx-caption !leading-relaxed !text-whx-faint">Restaurar repõe a disposição das ferramentas e os tamanhos dos painéis. Os documentos, conversas e terminais continuam abertos.</p>
    </>}</ControlPopover>
  </div>
}
