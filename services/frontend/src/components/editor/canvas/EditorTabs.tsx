import type { GitWorkingFile, WorkspaceFile } from '../../../types'
import { useEffect, useRef } from 'react'
import { workspaceDragEndedOutside, type WorkspaceSurfaceTransferPoint } from '../../../lib/workspace/layout/workspaceSurface'
import { Icon } from '../../presentation/chrome/Icon'
import { TabBar, TabButton } from '../../presentation/tabs'
import { FileGlyph } from './FileGlyph'
import { GitFileState } from './EditorGitState'
import { editorTabBarChrome, editorDocumentChrome, editorCloseChrome } from './editorTabChrome'
import { EditorDocumentsMenu } from './tabs'

type EditorDocument = WorkspaceFile & { draft: string }
const surfaceActionClass = 'grid size-7 shrink-0 place-items-center rounded-[4px] border-0 bg-transparent p-0 text-whx-faint transition-colors hover:bg-whx-hover hover:text-whx-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whx-accent disabled:pointer-events-none disabled:opacity-35'
const DOCUMENT_DRAG = 'application/x-wharnex-editor-document'
export function EditorTabs({ documents, activePath, savingPaths, gitByPath, surfaceMode = false, onSelect, onClose, onSave, onDetach, onSplit, onReorder }: {
  documents: EditorDocument[]; activePath?: string; savingPaths: Set<string>; gitByPath: Map<string, GitWorkingFile>; surfaceMode?: boolean
  onSelect: (path: string) => void; onClose: (path: string) => void; onSave: (path: string) => Promise<boolean>
  onDetach?: (path: string, point?: WorkspaceSurfaceTransferPoint) => void; onSplit?: (path: string, direction: 'vertical' | 'horizontal') => void
  onReorder?: (source: string, target: string, placement?: 'before' | 'after') => void
}) {
  const tabListRef = useRef<HTMLDivElement>(null)
  const dirty = documents.some((item) => item.path === activePath && item.draft !== item.content)
  const saving = Boolean(activePath && savingPaths.has(activePath))
  const saveStatus = saving ? 'A guardar…' : dirty ? 'Alterações por guardar' : 'Guardado'
  useEffect(() => {
    const revealActive = () => {
      const strip = tabListRef.current
      const activeTab = strip?.querySelector<HTMLElement>('[data-selected="true"]')
      if (!strip || !activeTab) return
      const stripRect = strip.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      if (tabRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - tabRect.left
      else if (tabRect.right > stripRect.right) strip.scrollLeft += tabRect.right - stripRect.right
    }
    revealActive()
    const strip = tabListRef.current
    if (typeof ResizeObserver === 'undefined' || !strip) return
    const observer = new ResizeObserver(revealActive)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [activePath, documents.length])
  return <div className={`editor-tabbar ${editorTabBarChrome}`}>
    <TabBar ref={tabListRef} appearance="document" label="Ficheiros abertos" className="min-w-0 flex-1">{documents.map((document, index) => {
      const dirty = document.draft !== document.content
      const gitFile = gitByPath.get(document.path)
      return <div key={document.path} data-resource-tab data-selected={activePath === document.path} className={editorDocumentChrome}>
        <TabButton appearance="document" className="h-full min-w-0 flex-1 justify-start gap-2 px-2.5 py-0" label={document.path.split('/').pop() || document.path} icon={<FileGlyph path={document.path} size={15}/>}
          selected={activePath === document.path} title={document.path} draggable={Boolean(onDetach || onReorder)}
          aria-description={onReorder ? 'Arraste para reorganizar ou use Alt+Shift+Seta esquerda/direita.' : undefined}
          onDragStart={(event) => { if (onReorder) event.dataTransfer.setData(DOCUMENT_DRAG, document.path) }}
          onDragOver={(event) => { if (onReorder && event.dataTransfer.types.includes(DOCUMENT_DRAG)) event.preventDefault() }}
          onDrop={(event) => { const source = event.dataTransfer.getData(DOCUMENT_DRAG); if (source && onReorder) { event.preventDefault(); event.stopPropagation(); onReorder(source, document.path) } }}
          onKeyDown={(event) => {
            if (!onReorder || !event.altKey || !event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
            event.preventDefault(); event.stopPropagation()
            const direction = event.key === 'ArrowLeft' ? -1 : 1
            const target = documents[index + direction]
            if (target) onReorder(document.path, target.path, direction < 0 ? 'before' : 'after')
          }}
          onDragEnd={(event) => { if (onDetach && workspaceDragEndedOutside(event)) onDetach(document.path, { screenX: event.screenX, screenY: event.screenY }) }}
          onClick={() => onSelect(document.path)} badge={gitFile || dirty ? <>{gitFile && <GitFileState file={gitFile} compact/>}{dirty && <i className="dirty-dot ml-0.5 size-1.5 rounded-full bg-whx-warning"/>}</> : undefined}/>
        {!surfaceMode && <button type="button" className={editorCloseChrome} onClick={() => onClose(document.path)} title={`Fechar ${document.path}`} aria-label={`Fechar ${document.path}`}><Icon name="close" size={12}/></button>}
      </div>
    })}</TabBar>
    <EditorDocumentsMenu documents={documents} activePath={activePath} onSelect={onSelect}/>
    <div className="editor-surface-actions ml-auto flex h-full shrink-0 items-center gap-1 border-l border-whx-border-soft bg-whx-surface px-1" role="toolbar" aria-label="Ferramentas do Editor">
      {onSplit && activePath && <div className="flex items-center gap-0.5" role="group" aria-label="Dividir editor"><button type="button" className={surfaceActionClass} onClick={() => onSplit(activePath, 'vertical')} title="Dividir editor verticalmente" aria-label="Dividir editor verticalmente"><Icon name="arrow-right" size={15}/></button><button type="button" className={surfaceActionClass} onClick={() => onSplit(activePath, 'horizontal')} title="Dividir editor horizontalmente" aria-label="Dividir editor horizontalmente"><Icon name="arrow-down" size={15}/></button></div>}
      {onDetach && activePath && <button type="button" className={surfaceActionClass} onClick={() => onDetach(activePath)} title="Abrir ficheiro numa janela independente" aria-label="Abrir ficheiro numa janela independente"><Icon name="external" size={15}/></button>}
      {activePath && <span className={`editor-autosave-status grid size-7 shrink-0 place-items-center ${saving ? 'text-whx-accent' : dirty ? 'text-whx-warning' : 'text-whx-faint'}`} role="status" aria-label={saveStatus} title={saveStatus}>{saving ? <span className="animate-spin"><Icon name="refresh" size={14}/></span> : dirty ? <i className="size-1.5 rounded-full bg-whx-warning"/> : <Icon name="check" size={14}/>}<span className="sr-only">{saveStatus}</span></span>}
      {activePath && <button type="button" className={`editor-save ${surfaceActionClass}`} disabled={!dirty || saving} onClick={() => void onSave(activePath)} aria-label="Guardar agora" title="Guardar agora (Ctrl+S)"><Icon name="save" size={15}/></button>}
    </div>
  </div>
}
