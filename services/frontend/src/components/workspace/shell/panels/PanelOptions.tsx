import type { WorkspaceRailSide } from '../../../../lib/workspace/layout/workspaceRailLayout'
import { Button, ControlPopover } from '../../../presentation/workbench'

export function PanelOptions({ label, scale, onScale, onReload, maximized, onMaximize, side, pinned, onMove }: { label: string; scale: number; onScale: (delta: number) => void; onReload?: () => void; maximized?: boolean; onMaximize?: () => void; side?: WorkspaceRailSide; pinned?: boolean; onMove?: (side: WorkspaceRailSide, pinned: boolean) => void }) {
  return <ControlPopover label={`Opções do painel ${label}`} density="compact">{(close) => <>
    {onMaximize && <Button icon="monitor" onClick={() => { onMaximize(); close() }}>{maximized ? 'Restaurar painel' : 'Maximizar painel'}</Button>}
    {onMove && side && <><Button icon="arrow-right" onClick={() => { onMove(side === 'left' ? 'right' : 'left', Boolean(pinned)); close() }}>Mover para a {side === 'left' ? 'direita' : 'esquerda'}</Button><Button icon="pin" onClick={() => { onMove(side, !pinned); close() }}>{pinned ? 'Desafixar da barra' : 'Fixar na barra'}</Button></>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-whx-label text-whx-soft">Tamanho do texto <b className="ml-1 font-mono">{Math.round(scale * 100)}%</b></span>
      <div className="flex gap-1">
        <Button aria-label={`Diminuir texto do painel ${label}`} disabled={scale <= 0.8} onClick={() => onScale(-0.1)}>A−</Button>
        <Button aria-label={`Aumentar texto do painel ${label}`} disabled={scale >= 1.4} onClick={() => onScale(0.1)}>A+</Button>
      </div>
    </div>
    {onReload && <Button icon="refresh" onClick={onReload}>Recarregar painel</Button>}
    <p className="!m-0 !text-whx-caption !leading-relaxed !text-whx-faint">Arraste a divisória para redimensionar. O tamanho e a disposição são conservados ao recolher.</p>
  </>}</ControlPopover>
}
