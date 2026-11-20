import { translate as uiText } from '../../../../lib/workspace/localization'
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { WorkspaceFile } from '../../../../types'
import { Icon } from '../../../presentation/chrome/Icon'
import { FileGlyph } from '../FileGlyph'

export function DocumentsList({ documents, activePath, onSelect }: {
  documents: (WorkspaceFile & { draft?: string })[]; activePath?: string; onSelect: (path: string) => void
}) {
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState<string | undefined>(activePath || documents[0]?.path)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const filtered = documents.filter((file) => file.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const current = Math.max(0, filtered.findIndex((file) => file.path === highlighted))
  useLayoutEffect(() => {
    const reveal = () => list.current?.querySelector('[data-highlighted=true]')?.scrollIntoView?.({ block: 'nearest' })
    reveal()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reveal)
    if (list.current) observer?.observe(list.current)
    return () => observer?.disconnect()
  }, [highlighted, query])
  function keyboard(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) return
    if ((event.key === 'Home' || event.key === 'End') && !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    if (!filtered.length) return
    if (event.key === 'Enter') { if (filtered[current]) onSelect(filtered[current].path); return }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length
    setHighlighted(filtered[next]?.path)
  }
  return <div className="flex min-h-0 flex-1 flex-col gap-2" onKeyDown={keyboard}>
    <div className="relative shrink-0">
      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-whx-faint"><Icon name="search" size={14}/></span>
      <input data-popover-autofocus role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={id} aria-activedescendant={filtered[current] ? `${id}-${current}` : undefined}
        aria-label={uiText("Pesquisar ficheiros abertos")} placeholder={uiText("Pesquisar por nome ou caminho…")} value={query} onChange={(event) => { setQuery(event.target.value); setHighlighted(undefined) }}
        className="!h-8 !min-h-8 !w-full !rounded !border !border-whx-border !bg-whx-bg !py-0 !pl-7 !pr-2 !text-whx-label !text-whx-text !shadow-none !outline-none focus:!border-whx-accent focus:!ring-0"/>
    </div>
    <div ref={list} id={id} role="listbox" aria-label={uiText("Ficheiros abertos")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
      {!filtered.length && <p role="status" className="px-2 py-3 text-whx-caption text-whx-faint">{uiText("Sem correspondências.")}</p>}
      {filtered.map((file, index) => {
        const parts = file.path.split('/')
        const name = parts.at(-1) || file.path
        const parent = parts.slice(0, -1).join('/')
        const selected = file.path === activePath
        return <button key={file.path} id={`${id}-${index}`} type="button" role="option" aria-selected={selected} tabIndex={-1}
          data-highlighted={index === current} data-popover-selected={selected ? '' : undefined}
          className={`!flex !h-9 !min-h-0 [[data-density=compact]_&]:!h-8 !w-full !min-w-0 !items-center !gap-2 !rounded !border-0 !px-2 !py-0 !text-left !shadow-none ${index === current ? '!bg-whx-hover !text-whx-text' : '!bg-transparent !text-whx-soft hover:!bg-whx-hover hover:!text-whx-text'}`}
          title={file.path} aria-current={selected ? 'page' : undefined}
          onPointerMove={() => setHighlighted(file.path)} onClick={() => onSelect(file.path)}>
          <FileGlyph path={file.path} size={15}/>
          <span className="grid min-w-0 flex-1 leading-tight">
            <strong className={`truncate text-whx-label ${selected ? 'font-semibold text-whx-text' : 'font-normal'}`}>{name}</strong>
            <small className="truncate text-whx-caption text-whx-faint">{parent || './'}</small>
          </span>
          {file.draft !== undefined && file.draft !== file.content && <span className="size-1.5 shrink-0 rounded-full bg-whx-warning" aria-label={uiText("Alterações por guardar")}/>}
          {selected && <span className="text-whx-accent"><Icon name="check" size={14}/></span>}
        </button>
      })}
    </div>
    <div className="flex shrink-0 justify-between border-t border-whx-border-soft px-2 pt-2 text-whx-caption text-whx-faint" aria-hidden="true"><span>{filtered.length} / {documents.length}</span><span>↑ ↓ · Enter</span></div>
  </div>
}
