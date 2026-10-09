import { nextTabIndex } from './nextTabIndex'
const surfaces = [
  { id: 'chat', label: 'Chat', path: 'M3 5h18v12H8l-5 4V5Z' },
  { id: 'files', label: 'Ficheiros', path: 'M3 6h7l2 2h9v11H3Z' },
  { id: 'plan', label: 'Plano', path: 'M4 6h16M4 12h10M4 18h13' },
  { id: 'execution', label: 'Execução', path: 'm4 7 4 4-4 4M11 16h9' },
] as const
// The paired app owns its UI independently; the Chat strip has the same sole icon-only exception.
export function ChatSurfaceTabs({ onNavigate }: { onNavigate: (surface: 'files' | 'plan' | 'execution') => void }) {
  return <div role="tablist" aria-label="Superfícies do chat" className="mt-2 flex min-h-10 gap-0.5 overflow-x-auto border-b border-line bg-surface" onKeyDown={(event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const next = nextTabIndex(event.key, tabs.indexOf(event.target as HTMLButtonElement), tabs.length)
    if (next === undefined) return
    event.preventDefault(); tabs[next].focus(); if (next !== 0) tabs[next].click()
  }}>
    {surfaces.map((surface) => <button key={surface.id} type="button" role="tab" aria-selected={surface.id === 'chat'} tabIndex={surface.id === 'chat' ? 0 : -1}
      title={surface.label} aria-label={surface.label} onClick={() => { if (surface.id !== 'chat') onNavigate(surface.id) }}
      className={`relative grid min-h-[39px] min-w-10 shrink-0 place-items-center rounded-none border-0 bg-transparent px-2.5 text-faint hover:bg-hover hover:text-soft focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--theme-tab-active)] after:absolute after:inset-x-[7px] after:bottom-0 after:h-0.5 ${surface.id === 'chat' ? 'text-ink after:bg-[var(--theme-tab-active)]' : 'after:bg-transparent'}`}>
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={surface.path}/></svg>
    </button>)}
  </div>
}
