import { useEditorNavigation } from './search/useEditorNavigation'
import { EditorTabs } from './EditorTabs'
import { useDocumentActions, useEditorDocumentReorder } from './tabs'
import { GitFileState } from './EditorGitState'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, APIError } from '../../../lib/transport/http/api'
import { editorDisplayLanguage } from '../../../lib/editor/runtime/editorLanguage'
import { disposeEditorModel } from '../../../lib/editor/runtime/monaco'
import { editorExecutableOptions, loadEditorRunHistory, parentDirectory, recentEditorRunOptions, rememberEditorRun, selectionCommand } from '../../../lib/editor/runtime/editorExecution'
import { type WorkspaceSurfaceTransferPoint } from '../../../lib/workspace/layout/workspaceSurface'
import { parseEditorGitChanges, type EditorGitChange } from '../../../lib/editor/runtime/editorGitChanges'
import { useGitLiveRefresh } from '../../../lib/git/workflow/useGitLiveRefresh'
import { dockerComposeRuntimeMarkers } from '../../../lib/editor/runtime/editorRuntimeMarkers'
import type { DockerOverview, FileEntry, GitFileDiff, GitWorkingFile, Session, TerminalRunInput, WorkspaceFile } from '../../../types'
import { CodeEditor } from './CodeEditor'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { ArtifactPreview } from '../../artifacts/explorer/ArtifactPreview'
import { ChangeDiffEditor } from './ChangeDiffEditor'
import { EditorSearchPalette, type EditorSearchMode } from './EditorSearchPalette'
import { EditorContextBar } from './context'
import { EditorWelcomePanel } from './EditorWelcomePanel'

type EditorDocument = WorkspaceFile & { draft: string }
type Cursor = { line: number; column: number }
type WorkspaceMutation = { kind: 'create'; path: string } | { kind: 'rename'; from: string; to: string } | { kind: 'delete'; path: string }

const EDITOR_AUTOSAVE_DELAY_MS = 650

export function EditorWorkspace({ session, onError, onRunInTerminal, openPath, openNonce = 0, openLocation, hiddenPaths = [], surfaceMode = false, minimalSurface = false, active = true, onDetachFile, onSplitFile, onLocateFile }: {
  session: Session
  onError: (message: string) => void
  onRunInTerminal: (input: TerminalRunInput) => void
  openPath?: string
  openNonce?: number
  openLocation?: { line: number; column: number }
  hiddenPaths?: string[]
  surfaceMode?: boolean
  minimalSurface?: boolean
  active?: boolean
  onDetachFile?: (path: string, point?: WorkspaceSurfaceTransferPoint) => void
  onSplitFile?: (path: string, direction: 'vertical' | 'horizontal') => void
  onLocateFile?: (path: string) => void
}) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [documents, setDocuments] = useState<EditorDocument[]>([])
  const reorderDocuments = useEditorDocumentReorder(setDocuments)
  const documentsRef = useRef<EditorDocument[]>([])
  const sessionIDRef = useRef(session.id)
  sessionIDRef.current = session.id
  const [activePath, setActivePath] = useState<string>()
  const [editorMemoryReady, setEditorMemoryReady] = useState(false)
  const [savingPaths, setSavingPaths] = useState<Set<string>>(new Set())
  const autosaveTimersRef = useRef(new Map<string, { id: number; draft: string }>())
  const savePromisesRef = useRef(new Map<string, Promise<boolean>>())
  const failedAutosaveDraftsRef = useRef(new Map<string, string>())
  const [cursor, setCursor] = useState<Cursor>({ line: 1, column: 1 })
  const [previewPaths, setPreviewPaths] = useState<Set<string>>(new Set())
  const [gitFiles, setGitFiles] = useState<GitWorkingFile[]>([])
  const [gitDiff, setGitDiff] = useState<GitFileDiff>()
  const [gitLineDiff, setGitLineDiff] = useState<GitFileDiff>()
  const [gitDiffScope, setGitDiffScope] = useState<string>()
  const [gitDiffLoading, setGitDiffLoading] = useState(false)
  const [dockerOverview, setDockerOverview] = useState<DockerOverview>()
  const [searchMode, setSearchMode] = useState<EditorSearchMode>()
  const [revealLocation, setRevealLocation] = useState<{ path: string; line: number; column: number; nonce: number }>()
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
  const gitByPath = useMemo(() => new Map(gitFiles.map((file) => [file.path, file])), [gitFiles])
  const selected = documents.find((item) => item.path === activePath && !hiddenPathSet.has(item.path))
  const selectedPath = selected?.path
  const selectedGit = selectedPath ? gitByPath.get(selectedPath) : undefined
  const selectedSaved = Boolean(selected && selected.draft === selected.content)
  const selectedComposeProject = useMemo(() => selectedPath ? dockerComposeProjectForFile(dockerOverview, session.project_path, selectedPath) : undefined, [dockerOverview, selectedPath, session.project_path])
  const gitLineChanges = useMemo(() => selectedSaved && selectedPath && gitLineDiff?.path === selectedPath ? parseEditorGitChanges(gitLineDiff.diff, selectedPath) : [], [gitLineDiff, selectedPath, selectedSaved])
  const runtimeMarkers = useMemo(() => selected && selectedComposeProject ? dockerComposeRuntimeMarkers(selected.draft, selectedComposeProject) : [], [selected, selectedComposeProject])
  useEffect(() => {
    if (activePath && hiddenPathSet.has(activePath)) setActivePath(visibleDocuments[0]?.path)
  }, [activePath, hiddenPathSet, visibleDocuments])
  const dirtyCount = documents.filter((item) => item.draft !== item.content).length
  const runOptions = selected ? editorExecutableOptions(selected.path, selected.draft, files) : []
  const recentRunOptions = recentEditorRunOptions(runOptions.filter((option) => option.line !== undefined), recentRuns)
  const directRunOption = runOptions.length === 1 && runOptions[0].line === undefined ? runOptions[0] : undefined

  documentsRef.current = documents

  const refreshFiles = useCallback(async () => {
    try { setFiles((await api.listFiles(session.id)).files) }
    catch (error) { onError(messageOf(error)) }
  }, [session.id, onError])

  const refreshGitState = useCallback(async () => {
    try {
      const overview = await api.gitOverview(session.id)
      setGitFiles(overview.available ? overview.working.files : [])
    } catch {
      setGitFiles([])
    }
  }, [session.id])

  useEffect(() => { void refreshFiles() }, [refreshFiles])
  useEffect(() => {
    void refreshGitState()
    if (!active) return
    const sync = () => { if (document.visibilityState === 'visible') void refreshGitState() }
    window.addEventListener('wharnex:git-working-tree-changed', sync)
    return () => window.removeEventListener('wharnex:git-working-tree-changed', sync)
  }, [active, refreshGitState])
  useGitLiveRefresh(active ? session.id : '', refreshGitState)
  useEffect(() => {
    const path = selectedPath
    if (!active || !path || !/\.ya?ml$/i.test(path)) {
      setDockerOverview(undefined)
      return
    }
    let cancelled = false
    const refreshDocker = async () => {
      try {
        const overview = await api.dockerOverview(session.id)
        if (!cancelled) setDockerOverview(overview)
      } catch {
        if (!cancelled) setDockerOverview(undefined)
      }
    }
    void refreshDocker()
    const timer = window.setInterval(refreshDocker, 10_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [active, selectedPath, session.id])
  useEffect(() => {
    if (!active || !selectedPath || !selectedGit || !selectedSaved || isBinaryPreview(selectedPath) || selectedGit.kind === 'submodule' || selectedGit.kind === 'embedded_repository') {
      setGitLineDiff(undefined)
      return
    }
    let cancelled = false
    void api.gitFileDiff(session.id, selectedPath)
      .then((diff) => { if (!cancelled) setGitLineDiff(diff) })
      .catch(() => { if (!cancelled) setGitLineDiff(undefined) })
    return () => { cancelled = true }
  }, [active, selectedGit, selectedPath, selectedSaved, session.id])
  useEffect(() => {
    setEditorMemoryReady(false)
    setDocuments([])
    documentsRef.current = []
    setSavingPaths(new Set())
    setActivePath(undefined)
    setCursor({ line: 1, column: 1 })
    setPreviewPaths(new Set())
    setGitFiles([])
    setGitDiff(undefined)
    setGitLineDiff(undefined)
    setGitDiffScope(undefined)
    setDockerOverview(undefined)
    setSearchMode(undefined)
    setRevealLocation(undefined)
    setRecentRuns(loadEditorRunHistory(session.project_path))
    failedAutosaveDraftsRef.current.clear()
    return () => {
      for (const timer of autosaveTimersRef.current.values()) window.clearTimeout(timer.id)
      autosaveTimersRef.current.clear()
      for (const document of documentsRef.current) disposeEditorModel(document.path)
    }
  }, [session.id, session.project_path])
  useEffect(() => {
    let cancelled = false
    const memory = loadEditorWorkspaceMemory(session.project_path)
    void (async () => {
      const restored: EditorDocument[] = []
      const preview = new Set<string>()
      for (const remembered of memory.documents.slice(0, 24)) {
        try {
          const file = isBinaryPreview(remembered.path)
            ? { path: remembered.path, content: '', sha256: '', size: 0 }
            : await api.readFile(session.id, remembered.path)
          if (cancelled) return
          const draft = remembered.sha256 && remembered.sha256 === file.sha256 ? remembered.draft : file.content
          restored.push({ ...file, draft })
          if (isRichPreview(remembered.path)) preview.add(remembered.path)
        } catch { /* files removed since shutdown are skipped */ }
      }
      if (cancelled) return
      documentsRef.current = restored
      setDocuments(restored)
      setPreviewPaths(preview)
      setActivePath(restored.some((item) => item.path === memory.activePath) ? memory.activePath : restored[0]?.path)
      setEditorMemoryReady(true)
    })()
    return () => { cancelled = true }
  }, [session.id, session.project_path])
  useEffect(() => {
    if (!editorMemoryReady) return
    saveEditorWorkspaceMemory(session.project_path, documents, activePath || '')
  }, [activePath, documents, editorMemoryReady, session.project_path])
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
        setGitLineDiff((current) => current && (current.path === detail.from || current.path.startsWith(`${detail.from}/`)) ? undefined : current)
      } else if (detail.kind === 'delete') {
        const removed = documentsRef.current.filter((item) => item.path === detail.path || item.path.startsWith(`${detail.path}/`))
        for (const document of removed) disposeEditorModel(document.path)
        setDocuments((items) => items.filter((item) => item.path !== detail.path && !item.path.startsWith(`${detail.path}/`)))
        setActivePath((current) => current && (current === detail.path || current.startsWith(`${detail.path}/`)) ? undefined : current)
        setPreviewPaths((items) => new Set([...items].filter((path) => path !== detail.path && !path.startsWith(`${detail.path}/`))))
        setGitDiff((current) => current && (current.path === detail.path || current.path.startsWith(`${detail.path}/`)) ? undefined : current)
        setGitLineDiff((current) => current && (current.path === detail.path || current.path.startsWith(`${detail.path}/`)) ? undefined : current)
      }
      void refreshFiles()
      void refreshGitState()
    }
    window.addEventListener('wharnex:workspace-files-changed', onWorkspaceMutation)
    return () => window.removeEventListener('wharnex:workspace-files-changed', onWorkspaceMutation)
  }, [refreshFiles, refreshGitState])

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

  async function openFileAt(path: string, line?: number, column?: number) {
    await openFile(path)
    if (!line) return
    setPreviewPaths((items) => { const next = new Set(items); next.delete(path); return next })
    setRevealLocation((current) => ({ path, line, column: column || 1, nonce: (current?.nonce || 0) + 1 }))
  }

  useEditorNavigation({ active, searchMode, setSearchMode, openPath, openNonce, openLocation, onOpen: openFile, onOpenAt: openFileAt })

  const save = useCallback(async (path: string): Promise<boolean> => {
    const saveKey = `${session.id}:${path}`
    const existing = savePromisesRef.current.get(saveKey)
    if (existing) return existing
    const operation = (async () => {
      const document = documentsRef.current.find((item) => item.path === path)
      if (!document || document.draft === document.content || isBinaryPreview(document.path)) return true
      const scheduled = autosaveTimersRef.current.get(path)
      if (scheduled) { window.clearTimeout(scheduled.id); autosaveTimersRef.current.delete(path) }
      const draft = document.draft
      const operationSessionID = session.id
      setSavingPaths((items) => new Set(items).add(path))
      try {
        const saved = await api.writeFile(operationSessionID, { path: document.path, content: draft, sha256: document.sha256 })
        if (sessionIDRef.current !== operationSessionID) return false
        failedAutosaveDraftsRef.current.delete(path)
        let fullySaved = true
        const nextDocuments = documentsRef.current.map((item) => {
          if (item.path !== document.path) return item
          if (item.draft === draft) return { ...saved, draft: saved.content }
          fullySaved = false
          return { ...item, content: saved.content, sha256: saved.sha256, size: saved.size }
        })
        documentsRef.current = nextDocuments
        setDocuments(nextDocuments)
        await Promise.all([refreshFiles(), refreshGitState()])
        window.dispatchEvent(new CustomEvent('wharnex:git-working-tree-changed'))
        return fullySaved
      } catch (error) {
        if (sessionIDRef.current !== operationSessionID) return false
        failedAutosaveDraftsRef.current.set(path, draft)
        onError(messageOf(error))
        return false
      } finally {
        setSavingPaths((items) => { const next = new Set(items); next.delete(path); return next })
      }
    })()
    savePromisesRef.current.set(saveKey, operation)
    try { return await operation } finally { savePromisesRef.current.delete(saveKey) }
  }, [onError, refreshFiles, refreshGitState, session.id])


  useEffect(() => {
    const openPaths = new Set(documents.map((document) => document.path))
    for (const [path, timer] of autosaveTimersRef.current) {
      const document = documents.find((item) => item.path === path)
      if (!openPaths.has(path) || !document || document.draft === document.content || failedAutosaveDraftsRef.current.get(path) === document.draft) {
        window.clearTimeout(timer.id)
        autosaveTimersRef.current.delete(path)
      }
    }
    for (const document of documents) {
      if (isBinaryPreview(document.path) || document.draft === document.content || failedAutosaveDraftsRef.current.get(document.path) === document.draft) continue
      const existing = autosaveTimersRef.current.get(document.path)
      if (existing?.draft === document.draft) continue
      if (existing) window.clearTimeout(existing.id)
      const id = window.setTimeout(() => { autosaveTimersRef.current.delete(document.path); void save(document.path) }, EDITOR_AUTOSAVE_DELAY_MS)
      autosaveTimersRef.current.set(document.path, { id, draft: document.draft })
    }
  }, [documents, save])

  function updateDraft(value: string) {
    if (!activePath) return
    const nextDocuments = documentsRef.current.map((item) => item.path === activePath ? { ...item, draft: value } : item)
    documentsRef.current = nextDocuments
    setDocuments(nextDocuments)
  }

  async function showGitDiff() {
    if (!selected) return
    setGitDiffScope(undefined)
    if (gitLineDiff?.path === selected.path) {
      setGitDiff(gitLineDiff)
      return
    }
    setGitDiffLoading(true)
    try {
      const diff = await api.gitFileDiff(session.id, selected.path)
      setGitLineDiff(diff)
      setGitDiff(diff)
    } catch (error) { onError(messageOf(error)) }
    finally { setGitDiffLoading(false) }
  }

  function showGitChange(change: EditorGitChange) {
    if (!selected) return
    const maxLine = Math.max(1, selected.draft.replace(/\r\n/g, '\n').split('\n').length)
    const start = change.kind === 'deleted' ? Math.min(change.anchorLine, maxLine) : change.startLine
    const end = change.kind === 'deleted' ? start : change.endLine
    setGitDiffScope(start === end ? `Alteração na linha ${start}` : `Alterações nas linhas ${start}–${end}`)
    setGitDiff({ path: selected.path, diff: change.diff })
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

  const documentActions = useDocumentActions({ projectPath: session.project_path, sessionID: session.id, documentsRef, setDocuments, activePath, setActivePath, setPreviewPaths, hiddenPaths: hiddenPathSet, save, reopen: openFile })

  return <section className="editor-workspace">
    <div className="editor-main">
      <div className="editor-area">
        {visibleDocuments.length > 0 && !minimalSurface && <EditorTabs documents={visibleDocuments} activePath={activePath} savingPaths={savingPaths} gitByPath={gitByPath} surfaceMode={surfaceMode} onSelect={setActivePath} onClose={documentActions.close} onCloseScope={documentActions.close} pinnedPaths={documentActions.pinned} onTogglePin={documentActions.togglePin} onReopen={documentActions.canReopen ? documentActions.reopen : undefined} projectPath={session.project_path} onLocate={onLocateFile} onError={onError} onSave={save} onDetach={onDetachFile} onSplit={onSplitFile} onReorder={reorderDocuments} />}
        {selected ? <>
          {!minimalSurface && <EditorContextBar path={selected.path} projectPath={session.project_path} gitFile={selectedGit} gitDiffDisabled={!selectedGit || gitDiffLoading || isBinaryPreview(selected.path) || selectedGit.kind === 'submodule' || selectedGit.kind === 'embedded_repository'} gitDiffLoading={gitDiffLoading} directRunOption={directRunOption} recentRunOptions={recentRunOptions} showPreviewToggle={isRichPreview(selected.path) && !isBinaryPreview(selected.path)} previewing={previewPaths.has(selected.path)} onLocate={onLocateFile ? () => onLocateFile(selected.path) : undefined} onShowGitDiff={() => void showGitDiff()} onRun={runAction} onTogglePreview={() => setPreviewPaths((items) => { const next = new Set(items); if (next.has(selected.path)) next.delete(selected.path); else next.add(selected.path); return next })}/>}
          {previewPaths.has(selected.path) ? <div className="editor-rich-preview"><ArtifactPreview sessionId={session.id} path={selected.path} size={selected.size} url={api.filePreviewURL(session.id, selected.path)}/></div> : <CodeEditor path={selected.path} value={selected.draft} viewStateScope={session.project_path} onChange={updateDraft} onSave={() => void save(selected.path)} onCursorChange={setCursor} onRunSelection={runSelection} runActions={runOptions.map(({ id, label, line }) => ({ id, label, line }))} onRunAction={runAction} gitChanges={gitLineChanges} onGitChangeClick={showGitChange} runtimeMarkers={runtimeMarkers} revealLine={revealLocation?.path === selected.path ? revealLocation.line : undefined} revealColumn={revealLocation?.path === selected.path ? revealLocation.column : undefined} revealNonce={revealLocation?.path === selected.path ? revealLocation.nonce : 0} />}
          {!minimalSurface && <div className="editor-statusbar">
            <div className="editor-statusbar-primary">
              <span className="editor-statusbar-path">{selected.path}</span>
            </div>
            <div className="editor-statusbar-meta">{selectedGit && <GitFileState file={selectedGit} compact/>}<span>Ln {cursor.line}, Col {cursor.column}</span><span>{editorDisplayLanguage(selected.path)}</span><span>UTF-8</span><span>{new Blob([selected.draft]).size.toLocaleString()} bytes</span></div>
          </div>}
        </> : <EditorWelcomePanel/>}
      </div>
    </div>
    {searchMode && <EditorSearchPalette mode={searchMode} sessionId={session.id} files={files} onClose={() => setSearchMode(undefined)} onOpen={(path, line, column) => void openFileAt(path, line, column)} />}
    {gitDiff && <InternalWindow title={`Diff de ${gitDiff.path}`} onClose={() => setGitDiff(undefined)} layerClassName="diff-inspector-backdrop">
      <section className="diff-inspector editor-git-diff" role="dialog" aria-modal="false" aria-label={`Diff de ${gitDiff.path}`}>
        <header><div><strong>{gitDiff.path}</strong><span>{gitDiffScope || (selected?.draft !== selected?.content ? 'O diff reflete o ficheiro guardado; aguarde o salvamento automático ou use Ctrl+S para o incluir.' : gitDiff.truncated ? 'Diff truncado a 512 KiB.' : 'Diferença do worktree em relação ao HEAD.')}</span></div><button type="button" className="icon-button" onClick={() => setGitDiff(undefined)} aria-label="Fechar diff">×</button></header>
        {gitDiffFile ? <ChangeDiffEditor sessionId={session.id} file={gitDiffFile} fragmentOnly={Boolean(gitDiffScope)} /> : <div className="editor-git-diff-empty"><Icon name="check" size={18}/><strong>Sem alterações Git neste ficheiro</strong><span>O conteúdo guardado coincide com HEAD ou o ficheiro ainda não faz parte de um diff rastreado.</span></div>}
      </section>
    </InternalWindow>}
  </section>
}


const EDITOR_WORKSPACE_MEMORY_PREFIX = 'whx.editor.workspace.v1:'
const MAX_PERSISTED_EDITOR_DRAFT = 512 * 1024

type EditorWorkspaceMemory = { activePath: string; documents: Array<{ path: string; draft: string; sha256: string }> }

function loadEditorWorkspaceMemory(projectPath: string): EditorWorkspaceMemory {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${EDITOR_WORKSPACE_MEMORY_PREFIX}${projectPath}`) || '{}')
    const documents = Array.isArray(parsed?.documents) ? parsed.documents.slice(0, 24).flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return []
      const item = value as Record<string, unknown>
      const path = String(item.path || '').trim()
      if (!path) return []
      return [{ path: path.slice(0, 4096), draft: String(item.draft || '').slice(-MAX_PERSISTED_EDITOR_DRAFT), sha256: String(item.sha256 || '').slice(0, 128) }]
    }) : []
    return { activePath: String(parsed?.activePath || ''), documents }
  } catch { return { activePath: '', documents: [] } }
}

function saveEditorWorkspaceMemory(projectPath: string, documents: EditorDocument[], activePath: string) {
  try {
    const persisted = documents.slice(0, 24).map((document) => ({ path: document.path, draft: document.draft.slice(-MAX_PERSISTED_EDITOR_DRAFT), sha256: document.sha256 }))
    localStorage.setItem(`${EDITOR_WORKSPACE_MEMORY_PREFIX}${projectPath}`, JSON.stringify({ version: 1, activePath, documents: persisted }))
  } catch { /* storage quota is best-effort */ }
}

function dockerComposeProjectForFile(overview: DockerOverview | undefined, projectRoot: string, path: string) {
  if (!overview) return undefined
  const absolutePath = normalizeEditorPath(path.startsWith('/') ? path : `${projectRoot}/${path}`)
  return overview.compose_projects.find((project) => (project.config_files ?? []).some((file) => normalizeEditorPath(file) === absolutePath))
}

function normalizeEditorPath(value: string) {
  const normalized = value.replaceAll('\\', '/').replace(/\/{2,}/g, '/')
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
}


function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return 'Erro inesperado' }
function isRichPreview(path: string) { return /\.(md|mdx|markdown|html?|pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov|m4v|docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(path) }
function isBinaryPreview(path: string) { return /\.(pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov|m4v|docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(path) }
