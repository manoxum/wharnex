import { Button, IconButton, StatusBadge } from '../../../presentation/workbench'

export function DiffToolbar({ complete, afterLabel = 'Versão aplicada', sideBySide, activeChange, changeCount, onNavigate, onLayout }: {
  afterLabel?: string; complete?: boolean; sideBySide: boolean; activeChange: number; changeCount: number
  onNavigate: (direction: -1 | 1) => void; onLayout: (sideBySide: boolean) => void
}) {
  return <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-whx-border-soft bg-whx-surface px-3 py-2">
    <div className="flex min-w-0 flex-wrap items-center gap-3 text-whx-caption text-whx-faint" role="group" aria-label="Comparação antes e depois"><span>Antes · Versão anterior</span><span aria-hidden="true">→</span><span className="text-whx-text">Depois · {afterLabel}</span>{complete === false && <StatusBadge icon="file">Excerto do patch</StatusBadge>}</div>
    <div className="flex flex-wrap items-center gap-1.5">
      <IconButton icon="arrow-up" label="Alteração anterior" disabled={!changeCount} onClick={() => onNavigate(-1)}/>
      <span className="min-w-8 text-center font-mono text-whx-caption text-whx-faint" aria-live="polite">{changeCount ? `${activeChange}/${changeCount}` : '0/0'}</span>
      <IconButton icon="arrow-down" label="Alteração seguinte" disabled={!changeCount} onClick={() => onNavigate(1)}/>
      <div className="ml-2 flex gap-1" role="group" aria-label="Modo do diff"><Button tone={sideBySide ? 'neutral' : 'quiet'} aria-pressed={sideBySide} onClick={() => onLayout(true)}>Lado a lado</Button><Button tone={!sideBySide ? 'neutral' : 'quiet'} aria-pressed={!sideBySide} onClick={() => onLayout(false)}>Inline</Button></div>
    </div>
  </div>
}
