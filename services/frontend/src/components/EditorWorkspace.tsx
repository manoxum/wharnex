import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, APIError } from '../lib/api'
import { editorDisplayLanguage } from '../lib/editorLanguage'
import { disposeEditorModel } from '../lib/monaco'
import { confirmDialog } from '../lib/appDialog'
import { editorExecutableOptions, loadEditorRunHistory, parentDirectory, recentEditorRunOptions, rememberEditorRun, selectionCommand } from '../lib/editorExecution'
import { workspaceDragEndedOutside, type WorkspaceSurfaceTransferPoint } from '../lib/workspaceSurface'
import type { FileEntry, GitFileDiff, Session, TerminalRunInput, WorkspaceFile } from '../types'
import { CodeEditor } from './CodeEditor'
import { Icon } from './Icon'
import { FileGlyph } from './FileGlyph'
import { ArtifactPreview } from './ArtifactPreview'
import { ChangeDiffEditor } from './ChangeDiffEditor'

type EditorDocument = WorkspaceFile & { draft: string }
type Cursor = { line: number; column: number }
type WorkspaceMutation = { kind: 'create'; path: string } | { kind: 'rename'; from: string; to: string } | { kind: 'delete'; path: string }

export function EditorWorkspace({ session, onError, onRunInTerminal, openPath, openNonce = 0, hiddenPaths = [], surfaceMode = false, minimalSurface = false, onDetachFile, onSplitFile }: {
  session: Session
  onError: (message: string) => void
  onRunInTerminal: (input: TerminalRunInput) => void
  openPath?: string
  openNonce?: number
  hiddenPaths?: string[]
  surfaceMode?: boolean
  minimalSurface?: boolean
  onDetachFile?: (path: string, point?: WorkspaceSurfaceTransferPoint) => void
  onSplitFile?: (path: string, direction: 'vertical' | 'horizontal') => void
}) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [documents, setDocuments] = useState<EditorDocument[]>([])
  const documentsRef = useRef<EditorDocument[]>([])
  const runMenuRef = useRef<HTMLDetailsElement>(null)
  const [activePath, setActivePath] = useState<string>()
  const [savingPath, setSavingPath] = useState<string>()
  const [cursor, setCursor] = useState<Cursor>({ line: 1, column: 1 })
  const [previewPaths, setPreviewPaths] = useState<Set<string>>(new Set())
  const [gitDiff, setGitDiff] = useState<GitFileDiff>()
  const [gitDiffLoading, setGitDiffLoading] = useState(false)
  // This workspace stays mounted (CSS-hidden) whenever another mode is
  // active, so an inline object literal here got a new identity on every one
  // of its many re-renders while a diff was open - and ChangeDiffEditor tears
  // down and recreates its whole Monaco diff editor (plus fresh html/json/
  // css/ts web workers) whenever its `file` prop's identity changes. That
  // churn, live-observed via the Network panel loading the same worker
  // scripts hundreds of times in a couple of minutes, was severe enough to
  // balloon a renderer to several GB and crash it. A stable reference tied to
  // the values that actually matter stops the recreation entirely.
  const gitDiffFile = useMemo(
    () => gitDiff?.diff ? { path: gitDiff.path, additions: 0, deletions: 0, diff: gitDiff.diff } : undefined,
    [gitDiff?.path, gitDiff?.diff],
  )
  const [recentRuns, setRecentRuns] = useState(() => loadEditorRunHistory(session.project_path))
  const hiddenPathSet = useMemo(() => new Set(hiddenPaths), [hiddenPaths])
  const visibleDocuments = useMemo(() => documents.filter((item) => !hiddenPathSet.has(item.path)), [documents, hiddenPathSet])
  const selected = documents.find((item) => item.path === activePath && !hiddenPathSet.has(item.path))
  useEffect(() => {
    if (activePath && hiddenPathSet.has(activePath)) setActivePath(visibleDocuments[0]?.path)
  }, [activePath, hiddenPathSet, visibleDocuments])
  const dirtyCount = documents.filter((item) => item.draft !== item.content).length
  const runOptions = selected ? editorExecutableOptions(selected.path, selected.draft, files) : []
  const recentRunOptions = recentEditorRunOptions(runOptions.filter((option) => option.line !== undefined), recentRuns)
  const directRunOption = runOptions.length === 1 && runOptions[0].line === undefined ? runOptions[0] : undefined

  documentsRef.current = documents

  useEffect(() => {
    const closeRunMenu = (event: Event) => {
      const menu = runMenuRef.current
      if (!menu?.open) return
      if (event.type === 'keydown' && (event as globalThis.KeyboardEvent).key === 'Escape') { menu.open = false; return }
      if (event.type === 'pointerdown' && event.target instanceof Node && !menu.contains(event.target)) menu.open = false
    }
    document.addEventListener('pointerdown', closeRunMenu)
    document.addEventListener('keydown', closeRunMenu)
    return () => {
      document.removeEventListener('pointerdown', closeRunMenu)
      document.removeEventListener('keydown', closeRunMenu)
    }
  }, [])

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
        {visibleDocuments.length > 0 && !minimalSurface && <EditorTabs documents={visibleDocuments} activePath={activePath} savingPath={savingPath} surfaceMode={surfaceMode} onSelect={setActivePath} onClose={closeDocument} onSave={save} onDetach={onDetachFile} onSplit={onSplitFile} />}
        {selected ? <>
          {!minimalSurface && <div className="editor-contextbar">
            <div className="editor-breadcrumbs">{selected.path.split('/').map((part, index, parts) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 && <i>›</i>}</span>)}</div>
            <div className="editor-shortcuts">
              <button title="Comparar o ficheiro guardado com o Git" disabled={gitDiffLoading || isBinaryPreview(selected.path)} onClick={() => void showGitDiff()}><Icon name="git" size={12}/>{gitDiffLoading ? 'A comparar…' : 'Git diff'}</button>
              {directRunOption && <button title={directRunOption.label} onClick={() => runAction(directRunOption.id)}><Icon name="play" size={11}/> Executar</button>}
              {recentRunOptions.length > 0 && <details ref={runMenuRef} className="editor-run-menu"><summary><Icon name="play" size={11}/> Recentes</summary><div>{recentRunOptions.map((option) => <button type="button" key={`${option.cwd}:${option.command}`} onClick={(event) => { runAction(option.id); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open') }}><span>{option.label}</span><code>{option.command}</code></button>)}</div></details>}
              {isRichPreview(selected.path) && !isBinaryPreview(selected.path) && <button title="Alternar editor e pré-visualização" onClick={() => setPreviewPaths((items) => { const next = new Set(items); if (next.has(selected.path)) next.delete(selected.path); else next.add(selected.path); return next })}><Icon name={previewPaths.has(selected.path) ? 'code' : 'external'} size={12}/>{previewPaths.has(selected.path) ? 'Editar' : 'Pré-visualizar'}</button>}
              {!previewPaths.has(selected.path) && <><span>Ctrl+Shift+Enter executar seleção</span><span>F1 comandos</span><span>Alt+Z wrap</span></>}
            </div>
          </div>}
          {previewPaths.has(selected.path) ? <div className="editor-rich-preview"><ArtifactPreview sessionId={session.id} path={selected.path} size={selected.size} url={api.filePreviewURL(session.id, selected.path)}/></div> : <CodeEditor path={selected.path} value={selected.draft} onChange={updateDraft} onSave={() => void save(selected.path)} onCursorChange={setCursor} onRunSelection={runSelection} runActions={runOptions.map(({ id, label, line }) => ({ id, label, line }))} onRunAction={runAction} />}
          {!minimalSurface && <div className="editor-statusbar">
            <span>{selected.path}</span>
            <div><span>Ln {cursor.line}, Col {cursor.column}</span><span>{editorDisplayLanguage(selected.path)}</span><span>UTF-8</span><span>{new Blob([selected.draft]).size.toLocaleString()} bytes</span></div>
          </div>}
        </> : <div className="editor-empty"><div className="empty-mark">&lt;/&gt;</div><h3>Abra um ficheiro no Explorador do projeto</h3><p>O Editor agora usa o explorador único do workbench. Abra a tool window Projeto numa das barras e escolha um ficheiro; as tabs preservam rascunhos, undo, pesquisa, folding e navegação por linha.</p></div>}
      </div>
    </div>
    {gitDiff && <div className="diff-inspector-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setGitDiff(undefined) }}>
      <section className="diff-inspector editor-git-diff">
        <header><div><strong>{gitDiff.path}</strong><span>{selected?.draft !== selected?.content ? 'O diff reflete o ficheiro guardado; guarde o rascunho para o incluir.' : gitDiff.truncated ? 'Diff truncado a 512 KiB.' : 'Diferença do worktree em relação ao HEAD.'}</span></div><button type="button" className="icon-button" onClick={() => setGitDiff(undefined)} aria-label="Fechar diff">×</button></header>
        {gitDiffFile ? <ChangeDiffEditor sessionId={session.id} file={gitDiffFile} /> : <div className="editor-git-diff-empty"><Icon name="check" size={18}/><strong>Sem alterações Git neste ficheiro</strong><span>O conteúdo guardado coincide com HEAD ou o ficheiro ainda não faz parte de um diff rastreado.</span></div>}
      </section>
    </div>}
  </section>
}

function EditorTabs({ documents, activePath, savingPath, surfaceMode = false, onSelect, onClose, onSave, onDetach, onSplit }: {
  documents: EditorDocument[]; activePath?: string; savingPath?: string; surfaceMode?: boolean
  onSelect: (path: string) => void; onClose: (path: string) => void; onSave: (path: string) => Promise<void>
  onDetach?: (path: string, point?: WorkspaceSurfaceTransferPoint) => void; onSplit?: (path: string, direction: 'vertical' | 'horizontal') => void
}) {
  return <div className="editor-tabbar">
    <div className="editor-tabs-scroll">{documents.map((document) => {
      const dirty = document.draft !== document.content
      const name = document.path.split('/').pop() || document.path
      return <button className={`editor-tab ${activePath === document.path ? 'active' : ''}`} key={document.path} draggable={Boolean(onDetach)} onDragEnd={(event) => { if (onDetach && workspaceDragEndedOutside(event)) onDetach(document.path, { screenX: event.screenX, screenY: event.screenY }) }} onClick={() => onSelect(document.path)} title={document.path}>
        <FileGlyph path={document.path} size={13}/><span>{name}</span>{dirty && <i className="dirty-dot"/>}
        {!surfaceMode && <span className="editor-tab-close" aria-hidden="true" onClick={(event) => { event.stopPropagation(); onClose(document.path) }}>×</span>}
      </button>
    })}</div>
    <div className="editor-surface-actions">
      {onSplit && activePath && <div className="surface-layout-actions" role="group" aria-label="Dividir editor"><button type="button" onClick={() => onSplit(activePath, 'vertical')} title="Dividir editor verticalmente" aria-label="Dividir editor verticalmente"><Icon name="arrow-right" size={13}/></button><button type="button" onClick={() => onSplit(activePath, 'horizontal')} title="Dividir editor horizontalmente" aria-label="Dividir editor horizontalmente"><Icon name="arrow-down" size={13}/></button></div>}
      {onDetach && activePath && <button type="button" className="surface-detach-action" onClick={() => onDetach(activePath)} title="Abrir ficheiro numa janela independente" aria-label="Abrir ficheiro numa janela independente"><Icon name="external" size={13}/></button>}
    <button className="editor-save" disabled={!activePath || !documents.some((item) => item.path === activePath && item.draft !== item.content) || Boolean(savingPath)} onClick={() => activePath && void onSave(activePath)} title="Guardar (Ctrl+S)"><Icon name="save" size={14}/>{savingPath ? 'A guardar…' : 'Guardar'}</button>
    </div>
  </div>
}

function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return 'Erro inesperado' }
function isRichPreview(path: string) { return /\.(md|mdx|markdown|html?|pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov|m4v|docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(path) }
function isBinaryPreview(path: string) { return /\.(pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov|m4v|docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(path) }
