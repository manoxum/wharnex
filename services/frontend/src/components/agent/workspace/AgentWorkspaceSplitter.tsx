import type { PointerEvent } from 'react'

export function AgentWorkspaceSplitter({ onPointerDown }: { onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void }) {
  return <button type="button" className="agent-splitter col-start-2 row-start-3 z-[15] w-1.5 touch-none cursor-col-resize border-0 border-l border-solid border-whx-border-soft border-r border-transparent bg-[color-mix(in_srgb,var(--theme-bg)_88%,var(--theme-border))] p-0 focus-visible:outline-1 focus-visible:outline-whx-border-soft max-[820px]:hidden"
    aria-label="Redimensionar chat e Engine" title="Arraste para redimensionar" onPointerDown={onPointerDown}/>
}
