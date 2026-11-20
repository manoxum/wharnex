import { translate as uiText, formatMessage } from '../../../../../lib/workspace/localization'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../../presentation/chrome/Icon'
import { IconButton } from '../../../../presentation/workbench'
type ProjectWindow = { windowId: string; projectPath: string; focused: boolean }
const FAVORITES = 'wharnex.workspace.favorites.v1'
function loadFavorites(): string[] { try { const value = JSON.parse(localStorage.getItem(FAVORITES) || '[]'); return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [] } catch { return [] } }
const name = (path: string) => path.split('/').filter(Boolean).at(-1) || path
export function WorkspaceSwitcher({ projects, recent, activeProject, otherWindows, busy, anchor, panelRef, onActivate, onUnbind, onFocus, onOpen, onForget, onBrowse, onClose }: {
  projects: string[]; recent: string[]; activeProject: string; otherWindows: ProjectWindow[]; busy: boolean
  anchor: { left: number; top: number; width: number }; panelRef: RefObject<HTMLDivElement | null>
  onActivate: (path: string) => void; onUnbind: (path: string) => void; onFocus: (item: ProjectWindow) => void
  onOpen?: (path: string) => void; onForget?: (path: string) => void; onBrowse?: () => void; onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState(loadFavorites)
  const [position, setPosition] = useState({ left: anchor.left, top: anchor.top })
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  useLayoutEffect(() => {
    const place = () => { const rect = panelRef.current?.getBoundingClientRect(); if (rect) setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(anchor.top, window.innerHeight - rect.height - 8)) }) }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, panelRef, query])
  function favorite(path: string) { const next = favorites.includes(path) ? favorites.filter((item) => item !== path) : [...favorites, path]; setFavorites(next); try { localStorage.setItem(FAVORITES, JSON.stringify(next)) } catch { /* best effort */ } }
  const matches = (path: string) => path.toLowerCase().includes(query.toLowerCase())
  const windows = new Map(otherWindows.map((item) => [item.projectPath, item]))
  const known = [...new Set([...projects, ...windows.keys(), ...recent, ...favorites])]
  const groups = [
    { id: 'favorites', label: uiText("Favoritos"), paths: known.filter((path) => favorites.includes(path)) },
    { id: 'current', label: uiText("Nesta janela"), paths: projects.filter((path) => !favorites.includes(path)) },
    { id: 'other', label: uiText("Outras janelas"), paths: [...windows.keys()].filter((path) => !favorites.includes(path) && !projects.includes(path)) },
    { id: 'recent', label: uiText("Recentes"), paths: recent.filter((path) => !projects.includes(path) && !windows.has(path) && !favorites.includes(path)) },
  ]
  const choose = (path: string) => { onClose(); if (projects.includes(path)) onActivate(path); else if (windows.has(path)) onFocus(windows.get(path)!); else onOpen?.(path) }
  return createPortal(<div ref={panelRef} role="dialog" aria-label={uiText("Projetos abertos")} className="project-window-popover fixed z-[10000] flex max-h-[min(560px,calc(100vh-16px))] w-[min(380px,calc(100vw-16px))] flex-col overflow-hidden rounded-lg border border-whx-border bg-whx-popover p-2 text-whx-label text-whx-text shadow-[0_12px_40px_var(--theme-shadow)] [-webkit-app-region:no-drag]" style={position} onKeyDown={(event) => {
    const buttons = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('button[data-project-select]:not(:disabled)') || [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus() }
    if (event.key === 'Enter' && event.target === input.current) { event.preventDefault(); buttons[0]?.click() }
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }}>
    <strong className="px-2 pb-2 font-semibold">{uiText("Projetos abertos")}</strong>
    <input ref={input} aria-label={uiText("Pesquisar projetos")} placeholder={uiText("Pesquisar nome ou caminho…")} value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-8 rounded-md border border-whx-border bg-whx-bg px-2 text-whx-label text-whx-text outline-none focus:border-whx-accent"/>
    <div className="min-h-0 overflow-y-auto py-1">
      {groups.map((group) => { const paths = group.paths.filter(matches); return paths.length ? <section key={group.id} className="py-1"><h3 className="!m-0 px-2 py-1 !text-whx-caption !font-medium !text-whx-faint">{group.label}</h3>{paths.map((path) => <div key={path} className={`group/project flex min-w-0 items-center rounded-md ${path === activeProject ? 'bg-whx-accent-soft' : 'hover:bg-whx-hover'}`}>
        <button type="button" data-project-select aria-label={`${name(path)}${windows.has(path) && !projects.includes(path) ? ` · ${uiText('Trazer janela para a frente')}` : ''} · ${path}`} disabled={busy || !projects.includes(path) && !windows.has(path) && !onOpen} aria-current={path === activeProject ? 'page' : undefined} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 border-0 bg-transparent px-2 py-1.5 text-left text-whx-text focus-visible:outline-2 focus-visible:outline-whx-accent" title={path} onClick={() => choose(path)}><Icon name={windows.has(path) && !projects.includes(path) ? 'external' : 'workspace'} size={16}/><span className="grid min-w-0 flex-1"><strong className="truncate text-whx-label font-medium">{name(path)}</strong><small className="truncate text-whx-caption text-whx-faint">{path}</small></span>{path === activeProject && <Icon name="check" size={13}/>}</button>
        <IconButton label={formatMessage(favorites.includes(path) ? 'Desafixar projeto {name}' : 'Fixar projeto {name}', { name: name(path) })} icon="pin" aria-pressed={favorites.includes(path)} onClick={() => favorite(path)}/>
        {projects.includes(path) ? <IconButton label={formatMessage('Desvincular {name} pelo menu de projetos', { name: name(path) })} icon="close" disabled={busy} onClick={() => { onClose(); onUnbind(path) }}/> : recent.includes(path) && <IconButton label={formatMessage('Remover {name} dos recentes', { name: name(path) })} title={uiText("Remover dos recentes; mantém os ficheiros no disco")} icon="close" disabled={busy || !onForget} onClick={() => onForget?.(path)}/>}
      </div>)}</section> : null })}
      {!known.some(matches) && <p className="px-2 py-3 text-whx-faint">{uiText("Nenhum projeto encontrado.")}</p>}
    </div>
    <button type="button" disabled={busy || !onBrowse} className="flex min-h-8 items-center gap-2 border-0 border-t border-solid border-whx-border-soft bg-transparent px-2 text-whx-label text-whx-soft hover:bg-whx-hover" onClick={() => { onClose(); onBrowse?.() }}><Icon name="folder" size={15}/>{uiText("Abrir outro projeto…")}</button>
  </div>, document.body)
}
