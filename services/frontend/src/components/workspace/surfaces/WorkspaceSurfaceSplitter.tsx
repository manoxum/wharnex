import type { PointerEvent } from 'react'
import type { WorkspaceSplitDirection } from '../../../lib/workspace'

export function WorkspaceSurfaceSplitter({ direction, onPointerDown }: {
  direction: WorkspaceSplitDirection
  onPointerDown: (event: PointerEvent<HTMLDivElement>, direction: WorkspaceSplitDirection) => void
}) {
  const axis = direction === 'vertical'
    ? 'w-1.5 cursor-col-resize after:h-full after:w-px'
    : 'h-1.5 cursor-row-resize after:h-px after:w-full'

  return <div role="separator" aria-orientation={direction === 'vertical' ? 'vertical' : 'horizontal'} aria-label="Redimensionar divisão do workspace"
    className={`relative z-[4] flex-[0_0_6px] touch-none bg-transparent after:absolute after:inset-0 after:m-auto after:bg-whx-border-soft after:content-[''] ${axis}`}
    onPointerDown={(event) => onPointerDown(event, direction)}/>
}
