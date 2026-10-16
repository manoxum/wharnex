import { useState, type ReactNode } from 'react'
import { Icon } from '../../../presentation/chrome/Icon'
import { IconButton, Input, EmptyState } from '../../../presentation/workbench'

export type DiffReviewItem = { id: string; path: string; label?: string; actionLabel?: string; additions: number; deletions: number; disabled?: boolean }
export function DiffReviewFrame({ items, selected, onSelect, children }: { items: DiffReviewItem[]; selected: DiffReviewItem; onSelect: (id: string) => void; children: ReactNode }) {
  const [filesCollapsed, setFilesCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const singleFile = items.length === 1
  const visibleItems = items.filter((file) => (file.label || file.path).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <div className={`git-diff-review @container flex h-full min-h-0 min-w-0 flex-1 flex-col bg-whx-bg ${singleFile ? 'single-file' : ''} ${filesCollapsed ? 'files-collapsed' : ''}`}>
    <div className={`grid min-h-0 min-w-0 flex-1 ${singleFile ? 'grid-cols-1' : filesCollapsed ? 'grid-cols-[40px_minmax(0,1fr)] @max-[700px]:grid-cols-1 @max-[700px]:grid-rows-[40px_minmax(0,1fr)]' : 'grid-cols-[minmax(200px,24%)_minmax(0,1fr)] @max-[700px]:grid-cols-1 @max-[700px]:grid-rows-[minmax(90px,25%)_minmax(0,1fr)]'}`}>
    {!singleFile && <aside className="git-diff-review-files flex min-h-0 min-w-0 flex-col border-r border-whx-border-soft bg-whx-surface @max-[700px]:border-b @max-[700px]:border-r-0" aria-label="Ficheiros alterados">
      <div className="git-diff-review-files-toolbar flex min-h-10 shrink-0 items-center justify-between gap-2 px-1">
        {!filesCollapsed && <strong className="min-w-0 truncate pl-2 text-whx-caption font-medium text-whx-faint">Ficheiros · {items.length}</strong>}
        <IconButton icon={filesCollapsed ? 'chevron-right' : 'arrow-left'} label={filesCollapsed ? 'Expandir lista de ficheiros' : 'Recolher lista de ficheiros'} aria-expanded={!filesCollapsed} onClick={() => setFilesCollapsed((value) => !value)}/>
      </div>
      {!filesCollapsed && <><div className="px-2 pb-2"><Input aria-label="Filtrar ficheiros alterados" placeholder="Filtrar ficheiros…" value={query} onChange={(event) => setQuery(event.target.value)} className="!w-full"/></div><div className="git-diff-review-file-list min-h-0 overflow-y-auto px-1 pb-2">
        {visibleItems.map((file) => <button key={file.id} type="button" className={`!flex !min-h-9 !w-full !min-w-0 !items-center !gap-2 !rounded-md !border-0 !px-2 !py-2 !text-left !shadow-none focus-visible:!outline-whx-accent ${file.id === selected.id ? 'active !bg-whx-hover !text-whx-text' : '!bg-transparent !text-whx-soft hover:!bg-whx-hover'}`} aria-label={file.actionLabel || file.path} aria-pressed={file.id === selected.id} title={file.path} disabled={file.disabled} onClick={() => onSelect(file.id)}>
          <Icon name="file" size={14}/>
          <span className="min-w-0 flex-1 truncate font-mono text-whx-caption" title={file.path}>{file.label || file.path}</span>
          <small className="inline-flex shrink-0 gap-2 font-mono text-whx-caption"><b className="font-medium text-whx-success">+{file.additions}</b><i className="not-italic text-whx-danger">−{file.deletions}</i></small>
        </button>)}
        {!visibleItems.length && <EmptyState compact icon="search" title="Nenhum ficheiro encontrado" description="Altere o filtro para ver os ficheiros desta revisão."/>}
      </div></>}
    </aside>}
    <section className="git-diff-review-main flex min-h-0 min-w-0 flex-col bg-whx-bg">
      <header className="git-diff-review-file-heading flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-whx-border-soft bg-whx-surface px-4"><strong className="min-w-0 truncate font-mono text-whx-label font-medium text-whx-text" title={selected.path}>{selected.path}</strong><span className="inline-flex shrink-0 gap-3 font-mono text-whx-caption"><b className="font-medium text-whx-success">+{selected.additions}</b><i className="not-italic text-whx-danger">−{selected.deletions}</i></span></header>
      {children}
    </section>
    </div>
  </div>
}
