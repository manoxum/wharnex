import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../presentation/chrome/Icon'
import type { WorkbenchCommand } from './commandTypes'
export type { WorkbenchCommand } from './commandTypes'
import { searchCommands } from './commandSearch'
import { EmptyState, IconButton } from '../../../presentation/workbench'

export function CommandPalette({ commands, onClose, loading = false, error, onRetry }: { commands: WorkbenchCommand[]; onClose: () => void; loading?: boolean; error?: string; onRetry?: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [limit, setLimit] = useState(100)
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const matches = searchCommands(commands, query)
  const filtered = matches.slice(0, limit)
  useEffect(() => {
    const previous = document.activeElement
    input.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  useEffect(() => { root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [selected, query])
  const execute = (command: WorkbenchCommand | undefined) => { if (command) { onClose(); command.run() } }
  return createPortal(<div className="fixed inset-0 z-[9999] flex items-start justify-center bg-[color-mix(in_srgb,var(--theme-bg)_70%,transparent)] px-4 pt-[min(16vh,120px)]" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label="Pesquisar e executar comandos" className="flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-whx-border-soft bg-whx-popover shadow-[0_24px_80px_var(--theme-shadow)]" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        setSelected((current) => event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, filtered.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % Math.max(1, filtered.length))
      }
      if (event.key === 'Enter' && event.target === input.current) { event.preventDefault(); execute(filtered[selected]) }
      if (event.key === 'Tab') {
        const elements = root.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled):not([tabindex="-1"])')
        if (!elements?.length) return
        const first = elements[0], last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }}>
      <div className="flex items-center gap-3 border-b border-whx-border-soft px-4 py-3 text-whx-faint">
        <Icon name="search" size={19}/><input ref={input} role="combobox" aria-label="Pesquisar comandos" aria-autocomplete="list" aria-expanded="true" aria-controls={id} aria-activedescendant={filtered[selected] ? `${id}-${filtered[selected].id}` : undefined} className="!min-w-0 !flex-1 !rounded-none !border-0 !bg-transparent !p-1 !text-whx-body !text-whx-text !shadow-none !outline-none" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); setLimit(100) }} placeholder="Ficheiros, ferramentas, definições ou ações…"/><IconButton label="Fechar comandos" icon="close" onClick={onClose}/>
      </div>
      <div className="px-4 text-whx-caption text-whx-faint">{loading && <p role="status">A pesquisar ficheiros do projeto…</p>}{error && <p role="alert">{error} <button type="button" className="!border-0 !bg-transparent !text-whx-text !underline" onClick={onRetry}>Tentar novamente</button></p>}</div>
      <div id={id} role="listbox" aria-label="Comandos disponíveis" className="min-h-0 overflow-y-auto p-2">
        {filtered.map((command, index) => <button key={command.id} id={`${id}-${command.id}`} type="button" role="option" aria-selected={index === selected} tabIndex={-1} className={`!flex !w-full !items-center !gap-3 !rounded-md !border-0 !px-3 !py-2 !text-left !shadow-none ${index === selected ? '!bg-whx-hover !text-whx-text' : '!bg-transparent !text-whx-soft hover:!bg-whx-hover'}`} onPointerMove={() => setSelected(index)} onClick={() => execute(command)}><Icon name={command.icon} size={17}/><span className="min-w-0 flex-1"><strong className="block truncate text-whx-label font-medium">{command.label}</strong><small className="mt-0.5 block truncate text-whx-caption text-whx-faint" title={command.description}>{command.description}</small></span><span className="shrink-0 text-whx-caption text-whx-faint">{command.shortcut ? <kbd>{command.shortcut}</kbd> : command.group || <Icon name="arrow-right" size={13}/>}</span></button>)}
        {!filtered.length && !loading && <EmptyState compact icon="search" title="Nenhum comando encontrado" description="Procure pelo nome de uma ferramenta, por ficheiros ou pelo layout."/>}
      </div>
      {matches.length > limit && <button type="button" className="!border-0 !bg-whx-control !py-2 !text-whx-label !text-whx-soft" onClick={() => setLimit((value) => value + 100)}>Mostrar mais resultados ({filtered.length} de {matches.length})</button>}
      <footer className="flex gap-4 border-t border-whx-border-soft px-4 py-2 text-whx-caption text-whx-faint"><span>↑ ↓ navegar</span><span>Enter abrir</span><span className="ml-auto">Esc fechar</span></footer>
    </div>
  </div>, document.body)
}
