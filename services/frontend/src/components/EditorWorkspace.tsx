import { useCallback, useEffect, useRef, useState } from 'react'
import { api, APIError } from '../lib/api'
import { editorDisplayLanguage } from '../lib/editorLanguage'
import { disposeEditorModel } from '../lib/monaco'
import { confirmDialog } from '../lib/appDialog'
import type { FileEntry, Session, WorkspaceFile } from '../types'
import { CodeEditor } from './CodeEditor'
import { Icon } from './Icon'
import { InteractiveTerminal } from './InteractiveTerminal'
import { WorkspaceExplorer } from './WorkspaceExplorer'
import { ArtifactPreview } from './ArtifactPreview'

type EditorDocument = WorkspaceFile & { draft: string }
type Cursor = { line: number; column: number }

export function EditorWorkspace({ session, onError, openPath, openNonce = 0 }: { session: Session; onError: (message: string) => void; openPath?: string; openNonce?: number }) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [documents, setDocuments] = useState<EditorDocument[]>([])
  const documentsRef = useRef<EditorDocument[]>([])
  const [activePath, setActivePath] = useState<string>()
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [savingPath, setSavingPath] = useState<string>()
  const [terminalHeight, setTerminalHeight] = useState(245)
  const [cursor, setCursor] = useState<Cursor>({ line: 1, column: 1 })
  const [revealNonce, setRevealNonce] = useState(0)
  const [previewPaths, setPreviewPaths] = useState<Set<string>>(new Set())
  const selected = documents.find((item) => item.path === activePath)
  const dirtyCount = documents.filter((item) => item.draft !== item.content).length

  documentsRef.current = documents

  const refreshFiles = useCallback(async () => {
    setLoadingFiles(true)
    try { setFiles((await api.listFiles(session.id)).files) }
    catch (error) { onError(messageOf(error)) }
    finally { setLoadingFiles(false) }
  }, [session.id, onError])

  useEffect(() => { void refreshFiles() }, [refreshFiles])
  useEffect(() => {
    setDocuments([])
    setActivePath(undefined)
    setCursor({ line: 1, column: 1 })
    setPreviewPaths(new Set())
    return () => {
      for (const document of documentsRef.current) disposeEditorModel(document.path)
    }
  }, [session.id])
  useEffect(() => {
    if (!dirtyCount) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirtyCount])

  async function openFile(path: string) {
    if (documents.some((item) => item.path === path)) { setActivePath(path); return }
    try {
      const file = isBinaryPreview(path)
        ? { path, content: '', sha256: '', size: files.find((entry) => entry.path === path)?.size || 0 }
        : await api.readFile(session.id, path)
      setDocuments((items) => [...items, { ...file, draft: file.content }])
      if (isRichPreview(path)) setPreviewPaths((items) => new Set(items).add(path))
      setActivePath(path)
      setCursor({ line: 1, column: 1 })
    } catch (error) { onError(messageOf(error)) }
  }

  useEffect(() => {
    if (openPath && openNonce) void openFile(openPath)
    // openFile intentionally reads the latest document state for explicit cross-mode navigation.
  }, [openPath, openNonce])

  async function save(path = activePath) {
    const document = documents.find((item) => item.path === path)
    if (!document || document.draft === document.content) return
    setSavingPath(document.path)
    try {
      const saved = await api.writeFile(session.id, { path: document.path, content: document.draft, sha256: document.sha256 })
      setDocuments((items) => items.map((item) => item.path === document.path ? { ...saved, draft: saved.content } : item))
      await refreshFiles()
    } catch (error) { onError(messageOf(error)) }
    finally { setSavingPath(undefined) }
  }

  function updateDraft(value: string) {
    if (!activePath) return
    setDocuments((items) => items.map((item) => item.path === activePath ? { ...item, draft: value } : item))
  }


  async function createWorkspacePath(path: string, kind: 'file' | 'directory') {
    try {
      await api.createWorkspacePath(session.id, path, kind)
      await refreshFiles()
    } catch (error) { onError(messageOf(error)); throw error }
  }

  async function renameWorkspacePath(from: string, to: string) {
    const dirtyAffected = documents.filter((item) => (item.path === from || item.path.startsWith(`${from}/`)) && item.draft !== item.content)
    if (dirtyAffected.length && !(await confirmDialog({
      title: 'Renomear com rascunhos abertos?',
      message: `“${from}” contém ${dirtyAffected.length} ficheiro(s) aberto(s) com alterações não guardadas. Os rascunhos serão preservados nas tabs com o novo caminho.`,
      tone: 'warning',
      confirmLabel: 'Renomear mesmo assim',
    }))) throw new Error('rename cancelled')
    try {
      await api.renameWorkspacePath(session.id, from, to)
      const affected = documents.filter((item) => item.path === from || item.path.startsWith(`${from}/`))
      for (const document of affected) disposeEditorModel(document.path)
      const rename = (path: string) => path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path
      setDocuments((items) => items.map((item) => ({ ...item, path: rename(item.path) })))
      setActivePath((current) => current ? rename(current) : current)
      await refreshFiles()
    } catch (error) { onError(messageOf(error)); throw error }
  }

  async function deleteWorkspacePath(path: string) {
    const dirtyAffected = documents.filter((item) => (item.path === path || item.path.startsWith(`${path}/`)) && item.draft !== item.content)
    if (dirtyAffected.length && !(await confirmDialog({
      title: 'Eliminar com alterações não guardadas?',
      message: `Existem ${dirtyAffected.length} ficheiro(s) com alterações não guardadas dentro de “${path}”. Esses rascunhos serão descartados.`,
      tone: 'danger',
      confirmLabel: 'Eliminar e descartar',
    }))) throw new Error('delete cancelled')
    try {
      await api.deleteWorkspacePath(session.id, path)
      const removed = documents.filter((item) => item.path === path || item.path.startsWith(`${path}/`))
      for (const document of removed) disposeEditorModel(document.path)
      setDocuments((items) => items.filter((item) => item.path !== path && !item.path.startsWith(`${path}/`)))
      setActivePath((current) => current && (current === path || current.startsWith(`${path}/`)) ? undefined : current)
      await refreshFiles()
    } catch (error) { onError(messageOf(error)); throw error }
  }

  async function closeDocument(path: string) {
    const document = documents.find((item) => item.path === path)
    if (!document) return
    if (document.draft !== document.content && !(await confirmDialog({
      title: 'Descartar alterações não guardadas?',
      message: `Fechar “${path}” agora descartará as alterações ainda não guardadas deste ficheiro.`,
      tone: 'warning',
      confirmLabel: 'Fechar e descartar',
    }))) return
    disposeEditorModel(path)
    const index = documents.findIndex((item) => item.path === path)
    const remaining = documents.filter((item) => item.path !== path)
    setDocuments(remaining)
    setPreviewPaths((items) => { const next = new Set(items); next.delete(path); return next })
    if (activePath === path) setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path)
  }

  return <section className="editor-workspace">
    <WorkspaceExplorer entries={files} activePath={selected?.path} loading={loadingFiles} revealNonce={revealNonce} onOpen={openFile} onRefresh={refreshFiles} onCreate={createWorkspacePath} onRename={renameWorkspacePath} onDelete={deleteWorkspacePath} />
    <div className="editor-main">
      <div className="editor-area">
        {documents.length > 0 && <EditorTabs documents={documents} activePath={activePath} savingPath={savingPath} onSelect={setActivePath} onClose={closeDocument} onSave={save} />}
        {selected ? <>
          <div className="editor-contextbar">
            <div className="editor-breadcrumbs">{selected.path.split('/').map((part, index, parts) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 && <i>›</i>}</span>)}</div>
            <div className="editor-shortcuts"><button title="Localizar este ficheiro no Explorer" onClick={() => setRevealNonce((value) => value + 1)}><Icon name="locate" size={12}/> Explorer</button>{isRichPreview(selected.path) && !isBinaryPreview(selected.path) && <button title="Alternar editor e pré-visualização" onClick={() => setPreviewPaths((items) => { const next = new Set(items); if (next.has(selected.path)) next.delete(selected.path); else next.add(selected.path); return next })}><Icon name={previewPaths.has(selected.path) ? 'code' : 'external'} size={12}/>{previewPaths.has(selected.path) ? 'Editar' : 'Pré-visualizar'}</button>} {!previewPaths.has(selected.path) && <><span>Ctrl+F localizar</span><span>Ctrl+G linha</span><span>F1 comandos</span><span>Alt+Z wrap</span></>}</div>
          </div>
          {previewPaths.has(selected.path) ? <div className="editor-rich-preview"><ArtifactPreview sessionId={session.id} path={selected.path} size={selected.size} url={api.filePreviewURL(session.id, selected.path)}/></div> : <CodeEditor path={selected.path} value={selected.draft} onChange={updateDraft} onSave={() => void save(selected.path)} onCursorChange={setCursor} />}
          <div className="editor-statusbar">
            <span>{selected.path}</span>
            <div><span>Ln {cursor.line}, Col {cursor.column}</span><span>{editorDisplayLanguage(selected.path)}</span><span>UTF-8</span><span>{new Blob([selected.draft]).size.toLocaleString()} bytes</span></div>
          </div>
        </> : <div className="editor-empty"><div className="empty-mark">&lt;/&gt;</div><h3>Escolha um ficheiro</h3><p>O Explorer mostra apenas ficheiros permitidos pela política do Harness. Abra vários ficheiros em tabs; o editor preserva rascunhos, histórico de undo, pesquisa, folding e navegação por linha.</p></div>}
      </div>
      <div className="terminal-resizer" title="Ajustar terminal" onDoubleClick={() => setTerminalHeight(245)} />
      <InteractiveTerminal session={session} height={terminalHeight} onHeight={setTerminalHeight} onError={onError} />
    </div>
  </section>
}

function EditorTabs({ documents, activePath, savingPath, onSelect, onClose, onSave }: {
  documents: EditorDocument[]; activePath?: string; savingPath?: string
  onSelect: (path: string) => void; onClose: (path: string) => void; onSave: (path: string) => Promise<void>
}) {
  return <div className="editor-tabbar">
    <div className="editor-tabs-scroll">{documents.map((document) => {
      const dirty = document.draft !== document.content
      const name = document.path.split('/').pop() || document.path
      return <button className={`editor-tab ${activePath === document.path ? 'active' : ''}`} key={document.path} onClick={() => onSelect(document.path)} title={document.path}>
        <Icon name="file" size={13}/><span>{name}</span>{dirty && <i className="dirty-dot"/>}
        <span className="editor-tab-close" aria-hidden="true" onClick={(event) => { event.stopPropagation(); onClose(document.path) }}>×</span>
      </button>
    })}</div>
    <button className="editor-save" disabled={!activePath || !documents.some((item) => item.path === activePath && item.draft !== item.content) || Boolean(savingPath)} onClick={() => activePath && void onSave(activePath)} title="Guardar (Ctrl+S)"><Icon name="save" size={14}/>{savingPath ? 'A guardar…' : 'Guardar'}</button>
  </div>
}


function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return 'Erro inesperado' }
function isRichPreview(path: string) { return /\.(md|mdx|markdown|html?|pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov|m4v|docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(path) }
function isBinaryPreview(path: string) { return /\.(pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov|m4v|docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(path) }
