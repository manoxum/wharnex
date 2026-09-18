import { useCallback, useEffect, useRef, useState } from 'react'
import { api, APIError } from '../lib/api'
import { editorDisplayLanguage } from '../lib/editorLanguage'
import { disposeEditorModel } from '../lib/monaco'
import { confirmDialog } from '../lib/appDialog'
import { editorExecutableOptions, loadEditorRunHistory, parentDirectory, recentEditorRunOptions, rememberEditorRun, selectionCommand } from '../lib/editorExecution'
import type { FileEntry, GitFileDiff, Session, TerminalRunInput, WorkspaceFile } from '../types'
import { CodeEditor } from './CodeEditor'
import { Icon } from './Icon'
import { FileGlyph } from './FileGlyph'
import { ArtifactPreview } from './ArtifactPreview'
import { ChangeDiffEditor } from './ChangeDiffEditor'

type EditorDocument = WorkspaceFile & { draft: string }
type Cursor = { line: number; column: number }
type WorkspaceMutation = { kind: 'create'; path: string } | { kind: 'rename'; from: string; to: string } | { kind: 'delete'; path: string }

export function EditorWorkspace({ session, onError, onRunInTerminal, openPath, openNonce = 0 }: {
  session: Session
  onError: (message: string) => void
  onRunInTerminal: (input: TerminalRunInput) => void
  openPath?: string
  openNonce?: number
}) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [documents, setDocuments] = useState<EditorDocument[]>([])
  const documentsRef = useRef<EditorDocument[]>([])
  const [activePath, setActivePath] = useState<string>()
  const [savingPath, setSavingPath] = useState<string>()
  const [cursor, setCursor] = useState<Cursor>({ line: 1, column: 1 })
  const [previewPaths, setPreviewPaths] = useState<Set<string>>(new Set())
  const [gitDiff, setGitDiff] = useState<GitFileDiff>()
  const [gitDiffLoading, setGitDiffLoading] = useState(false)
  const [recentRuns, setRecentRuns] = useState(() => loadEditorRunHistory(session.project_path))
  const selected = documents.find((item) => item.path === activePath)
  const dirtyCount = documents.filter((item) => item.draft !== item.content).length
  const runOptions = selected ? editorExecutableOptions(selected.path, selected.draft, files) : []
  const recentRunOptions = recentEditorRunOptions(runOptions.filter((option) => option.line !== undefined), recentRuns)
  const directRunOption = runOptions.length === 1 && runOptions[0].line === undefined ? runOptions[0] : undefined

  documentsRef.current = documents

  const refreshFiles = useCallback(async () => {
    try { setFiles((await api.listFiles(session.id)).files) }
    catch (error) { onError(messageOf(error)) }
  }, [session.id, onError])

  useEffect(() => { void refreshFiles() }, [refreshFiles])
  useEffect(() => {
    setDocuments([])
    setActivePath(undefined)
    setCursor({ line: 1, column: 1 })
    setPreviewPaths(new Set())
    setGitDiff(undefined)
    setRecentRuns(loadEditorRunHistory(session.project_path))
    return () => {
      for (const document of documentsRef.current) disposeEditorModel(document.path)
    }
  }, [session.id, session.project_path])
  useEffect(() => {
    if (!dirtyCount) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirtyCount])

  useEffect(() => {
    const onWorkspaceMutation = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceMutation>).detail
      if (!detail) return
      if (detail.kind === 'rename') {
        const affected = documentsRef.current.filter((item) => item.path === detail.from || item.path.startsWith(`${detail.from}/`))
        for (const document of affected) disposeEditorModel(document.path)
        const rename = (path: string) => path === detail.from ? detail.to : path.startsWith(`${detail.from}/`) ? `${detail.to}${path.slice(detail.from.length)}` : path
        setDocuments((items) => items.map((item) => ({ ...item, path: rename(item.path) })))
        setActivePath((current) => current ? rename(current) : current)
        setPreviewPaths((items) => new Set([...items].map(rename)))
        setGitDiff((current) => current && (current.path === detail.from || current.path.startsWith(`${detail.from}/`)) ? undefined : current)
      } else if (detail.kind === 'delete') {
        const removed = documentsRef.current.filter((item) => item.path === detail.path || item.path.startsWith(`${detail.path}/`))
        for (const document of removed) disposeEditorModel(document.path)
        setDocuments((items) => items.filter((item) => item.path !== detail.path && !item.path.startsWith(`${detail.path}/`)))
        setActivePath((current) => current && (current === detail.path || current.startsWith(`${detail.path}/`)) ? undefined : current)
        setPreviewPaths((items) => new Set([...items].filter((path) => path !== detail.path && !path.startsWith(`${detail.path}/`))))
        setGitDiff((current) => current && (current.path === detail.path || current.path.startsWith(`${detail.path}/`)) ? undefined : current)
      }
      void refreshFiles()
    }
    window.addEventListener('wharnex:workspace-files-changed', onWorkspaceMutation)
    return () => window.removeEventListener('wharnex:workspace-files-changed', onWorkspaceMutation)
  }, [refreshFiles])

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

  async function showGitDiff() {
    if (!selected) return
    setGitDiffLoading(true)
    try { setGitDiff(await api.gitFileDiff(session.id, selected.path)) }
    catch (error) { onError(messageOf(error)) }
    finally { setGitDiffLoading(false) }
  }

  function runSelection(text: string) {
    if (!selected || !text.trim()) return
    runInTerminal({ command: selectionCommand(selected.path, text.trim()), cwd: parentDirectory(selected.path), label: `Seleção · ${selected.path}` })
  }

  function runInTerminal(input: TerminalRunInput) {
    setRecentRuns(rememberEditorRun(session.project_path, input))
    onRunInTerminal(input)
  }

  function runAction(id: string) {
    const option = runOptions.find((item) => item.id === id)
    if (option) runInTerminal(option)
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
    <div className="editor-main">
      <div className="editor-area">
        {documents.length > 0 && <EditorTabs documents={documents} activePath={activePath} savingPath={savingPath} onSelect={setActivePath} onClose={closeDocument} onSave={save} />}
        {selected ? <>
          <div className="editor-contextbar">
            <div className="editor-breadcrumbs">{selected.path.split('/').map((part, index, parts) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 && <i>›</i>}</span>)}</div>
            <div className="editor-shortcuts">
              <button title="Comparar o ficheiro guardado com o Git" disabled={gitDiffLoading || isBinaryPreview(selected.path)} onClick={() => void showGitDiff()}><Icon name="git" size={12}/>{gitDiffLoading ? 'A comparar…' : 'Git diff'}</button>
              {directRunOption && <button title={directRunOption.label} onClick={() => runAction(directRunOption.id)}><Icon name="play" size={11}/> Executar</button>}
              {recentRunOptions.length > 0 && <details className="editor-run-menu"><summary><Icon name="play" size={11}/> Recentes</summary><div>{recentRunOptions.map((option) => <button type="button" key={`${option.cwd}:${option.command}`} onClick={(event) => { runAction(option.id); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open') }}><span>{option.label}</span><code>{option.command}</code></button>)}</div></details>}
              {isRichPreview(selected.path) && !isBinaryPreview(selected.path) && <button title="Alternar editor e pré-visualização" onClick={() => setPreviewPaths((items) => { const next = new Set(items); if (next.has(selected.path)) next.delete(selected.path); else next.add(selected.path); return next })}><Icon name={previewPaths.has(selected.path) ? 'code' : 'external'} size={12}/>{previewPaths.has(selected.path) ? 'Editar' : 'Pré-visualizar'}</button>}
              {!previewPaths.has(selected.path) && <><span>Ctrl+Shift+Enter executar seleção</span><span>F1 comandos</span><span>Alt+Z wrap</span></>}
            </div>
          </div>
          {previewPaths.has(selected.path) ? <div className="editor-rich-preview"><ArtifactPreview sessionId={session.id} path={selected.path} size={selected.size} url={api.filePreviewURL(session.id, selected.path)}/></div> : <CodeEditor path={selected.path} value={selected.draft} onChange={updateDraft} onSave={() => void save(selected.path)} onCursorChange={setCursor} onRunSelection={runSelection} runActions={runOptions.map(({ id, label, line }) => ({ id, label, line }))} onRunAction={runAction} />}
          <div className="editor-statusbar">
            <span>{selected.path}</span>
            <div><span>Ln {cursor.line}, Col {cursor.column}</span><span>{editorDisplayLanguage(selected.path)}</span><span>UTF-8</span><span>{new Blob([selected.draft]).size.toLocaleString()} bytes</span></div>
          </div>
        </> : <div className="editor-empty"><div className="empty-mark">&lt;/&gt;</div><h3>Abra um ficheiro no Explorador do projeto</h3><p>O Editor agora usa o explorador único do workbench. Abra a tool window Projeto numa das barras e escolha um ficheiro; as tabs preservam rascunhos, undo, pesquisa, folding e navegação por linha.</p></div>}
      </div>
    </div>
    {gitDiff && <div className="diff-inspector-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setGitDiff(undefined) }}>
      <section className="diff-inspector editor-git-diff">
        <header><div><strong>{gitDiff.path}</strong><span>{selected?.draft !== selected?.content ? 'O diff reflete o ficheiro guardado; guarde o rascunho para o incluir.' : gitDiff.truncated ? 'Diff truncado a 512 KiB.' : 'Diferença do worktree em relação ao HEAD.'}</span></div><button type="button" className="icon-button" onClick={() => setGitDiff(undefined)} aria-label="Fechar diff">×</button></header>
        {gitDiff.diff ? <ChangeDiffEditor sessionId={session.id} file={{ path: gitDiff.path, additions: 0, deletions: 0, diff: gitDiff.diff }} /> : <div className="editor-git-diff-empty"><Icon name="check" size={18}/><strong>Sem alterações Git neste ficheiro</strong><span>O conteúdo guardado coincide com HEAD ou o ficheiro ainda não faz parte de um diff rastreado.</span></div>}
      </section>
    </div>}
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
        <FileGlyph path={document.path} size={13}/><span>{name}</span>{dirty && <i className="dirty-dot"/>}
        <span className="editor-tab-close" aria-hidden="true" onClick={(event) => { event.stopPropagation(); onClose(document.path) }}>×</span>
      </button>
    })}</div>
    <button className="editor-save" disabled={!activePath || !documents.some((item) => item.path === activePath && item.draft !== item.content) || Boolean(savingPath)} onClick={() => activePath && void onSave(activePath)} title="Guardar (Ctrl+S)"><Icon name="save" size={14}/>{savingPath ? 'A guardar…' : 'Guardar'}</button>
  </div>
}

function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return 'Erro inesperado' }
function isRichPreview(path: string) { return /\.(md|mdx|markdown|html?|pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov|m4v|docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(path) }
function isBinaryPreview(path: string) { return /\.(pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov|m4v|docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(path) }
