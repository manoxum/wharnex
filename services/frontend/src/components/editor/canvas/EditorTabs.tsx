import type { GitWorkingFile, WorkspaceFile } from '../../../types'
import { workspaceDragEndedOutside, type WorkspaceSurfaceTransferPoint } from '../../../lib/workspace/layout/workspaceSurface'
import { Icon } from '../../presentation/chrome/Icon'
import { TabBar, TabButton } from '../../presentation/tabs'
import { FileGlyph } from './FileGlyph'
import { GitFileState } from './EditorGitState'
import { editorTabBarChrome, editorDocumentChrome, editorCloseChrome } from './editorTabChrome'

type EditorDocument = WorkspaceFile & { draft: string }
export function EditorTabs({ documents, activePath, savingPaths, gitByPath, surfaceMode = false, onSelect, onClose, onSave, onDetach, onSplit }: {
  documents: EditorDocument[]; activePath?: string; savingPaths: Set<string>; gitByPath: Map<string, GitWorkingFile>; surfaceMode?: boolean
  onSelect: (path: string) => void; onClose: (path: string) => void; onSave: (path: string) => Promise<boolean>
  onDetach?: (path: string, point?: WorkspaceSurfaceTransferPoint) => void; onSplit?: (path: string, direction: 'vertical' | 'horizontal') => void
}) {
  const dirty = documents.some((item) => item.path === activePath && item.draft !== item.content)
  return <div className={`editor-tabbar ${editorTabBarChrome}`}>
    <TabBar appearance="document" label="Ficheiros abertos" className="min-w-0 flex-1">{documents.map((document) => {
      const dirty = document.draft !== document.content
      const gitFile = gitByPath.get(document.path)
      return <div key={document.path} data-resource-tab data-selected={activePath === document.path} className={editorDocumentChrome}>
        <TabButton appearance="document" label={document.path.split('/').pop() || document.path} icon={<FileGlyph path={document.path} size={13}/>}
          selected={activePath === document.path} title={document.path} draggable={Boolean(onDetach)}
          onDragEnd={(event) => { if (onDetach && workspaceDragEndedOutside(event)) onDetach(document.path, { screenX: event.screenX, screenY: event.screenY }) }}
          onClick={() => onSelect(document.path)} badge={gitFile || dirty ? <>{gitFile && <GitFileState file={gitFile} compact/>}{dirty && <i className="dirty-dot ml-0.5"/>}</> : undefined}/>
        {!surfaceMode && <button type="button" className={editorCloseChrome} onClick={() => onClose(document.path)} title={`Fechar ${document.path}`} aria-label={`Fechar ${document.path}`}>×</button>}
      </div>
    })}</TabBar>
    <div className="editor-surface-actions">
      {onSplit && activePath && <div className="surface-layout-actions" role="group" aria-label="Dividir editor"><button type="button" onClick={() => onSplit(activePath, 'vertical')} title="Dividir editor verticalmente" aria-label="Dividir editor verticalmente"><Icon name="arrow-right" size={13}/></button><button type="button" onClick={() => onSplit(activePath, 'horizontal')} title="Dividir editor horizontalmente" aria-label="Dividir editor horizontalmente"><Icon name="arrow-down" size={13}/></button></div>}
      {onDetach && activePath && <button type="button" className="surface-detach-action" onClick={() => onDetach(activePath)} title="Abrir ficheiro numa janela independente" aria-label="Abrir ficheiro numa janela independente"><Icon name="external" size={13}/></button>}
      {activePath && <span className={`editor-autosave-status ${savingPaths.has(activePath) ? 'saving' : dirty ? 'pending' : 'saved'}`}><i/>{savingPaths.has(activePath) ? 'A guardar…' : dirty ? 'Auto-save pendente' : 'Guardado'}</span>}
      <button className="editor-save" disabled={!activePath || !dirty || savingPaths.has(activePath)} onClick={() => activePath && void onSave(activePath)} aria-label="Guardar agora" title="Guardar agora (Ctrl+S)"><Icon name="save" size={14}/></button>
    </div>
  </div>
}
