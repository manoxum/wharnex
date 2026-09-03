import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, APIError } from '../lib/api'
import { editorDisplayLanguage } from '../lib/editorLanguage'
import { disposeEditorModel } from '../lib/monaco'
import type { FileEntry, Session, WorkspaceFile } from '../types'
import { CodeEditor } from './CodeEditor'
import { Icon } from './Icon'
import { InteractiveTerminal } from './InteractiveTerminal'

type EditorDocument = WorkspaceFile & { draft: string }
type Cursor = { line: number; column: number }

export function EditorWorkspace({ session, onError }: { session: Session; onError: (message: string) => void }) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [documents, setDocuments] = useState<EditorDocument[]>([])
  const documentsRef = useRef<EditorDocument[]>([])
  const [activePath, setActivePath] = useState<string>()
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [savingPath, setSavingPath] = useState<string>()
  const [terminalHeight, setTerminalHeight] = useState(245)
  const [cursor, setCursor] = useState<Cursor>({ line: 1, column: 1 })
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
      const file = await api.readFile(session.id, path)
      setDocuments((items) => [...items, { ...file, draft: file.content }])
      setActivePath(path)
      setCursor({ line: 1, column: 1 })
    } catch (error) { onError(messageOf(error)) }
  }

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

  function closeDocument(path: string) {
    const document = documents.find((item) => item.path === path)
    if (!document) return
    if (document.draft !== document.content && !window.confirm(`Fechar ${path} e descartar alterações não guardadas?`)) return
    disposeEditorModel(path)
    const index = documents.findIndex((item) => item.path === path)
    const remaining = documents.filter((item) => item.path !== path)
    setDocuments(remaining)
    if (activePath === path) setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path)
  }

  return <section className="editor-workspace">
    <FileExplorer entries={files} selected={selected?.path} loading={loadingFiles} onOpen={openFile} onRefresh={refreshFiles} />
    <div className="editor-main">
      <div className="editor-area">
        {documents.length > 0 && <EditorTabs documents={documents} activePath={activePath} savingPath={savingPath} onSelect={setActivePath} onClose={closeDocument} onSave={save} />}
        {selected ? <>
          <div className="editor-contextbar">
            <div className="editor-breadcrumbs">{selected.path.split('/').map((part, index, parts) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 && <i>›</i>}</span>)}</div>
            <div className="editor-shortcuts"><span>Ctrl+F localizar</span><span>Ctrl+G linha</span><span>F1 comandos</span><span>Alt+Z wrap</span></div>
          </div>
          <CodeEditor path={selected.path} value={selected.draft} onChange={updateDraft} onSave={() => void save(selected.path)} onCursorChange={setCursor} />
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

type TreeNode = { name: string; path: string; kind: 'file' | 'directory'; children: TreeNode[] }

function FileExplorer({ entries, selected, loading, onOpen, onRefresh }: { entries: FileEntry[]; selected?: string; loading: boolean; onOpen: (path: string) => void; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState('')
  const tree = useMemo(() => buildTree(query.trim() ? entries.filter((item) => item.kind === 'directory' || item.path.toLowerCase().includes(query.trim().toLowerCase())) : entries), [entries, query])
  return <aside className="file-explorer">
    <header><div><span className="panel-kicker">Workspace</span><strong>Explorer</strong></div><button className="icon-button" title="Atualizar ficheiros" onClick={() => void onRefresh()} disabled={loading}><Icon name="refresh" size={15}/></button></header>
    <div className="explorer-search"><Icon name="search" size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar ficheiros…" aria-label="Filtrar ficheiros" /></div>
    <div className="file-tree">{tree.map((node) => <TreeItem key={node.path} node={node} selected={selected} onOpen={onOpen} depth={0}/>)}</div>
  </aside>
}

function TreeItem({ node, selected, onOpen, depth }: { node: TreeNode; selected?: string; onOpen: (path: string) => void; depth: number }) {
  const [open, setOpen] = useState(depth < 1)
  if (node.kind === 'directory') return <div className="tree-group">
    <button className="tree-row folder-row" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setOpen((value) => !value)}><span className={`tree-chevron ${open ? 'open' : ''}`}><Icon name="chevron" size={12}/></span><Icon name="folder" size={14}/><span>{node.name}</span></button>
    {open && node.children.map((child) => <TreeItem key={child.path} node={child} selected={selected} onOpen={onOpen} depth={depth + 1}/>) }
  </div>
  return <button className={`tree-row file-row ${selected === node.path ? 'active' : ''}`} style={{ paddingLeft: 25 + depth * 14 }} onClick={() => onOpen(node.path)}><Icon name="file" size={13}/><span>{node.name}</span></button>
}

function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'directory', children: [] }
  const directories = new Map<string, TreeNode>([['', root]])
  for (const entry of entries.filter((item) => item.kind === 'directory').sort((a, b) => a.path.localeCompare(b.path))) ensureDir(root, directories, entry.path)
  for (const entry of entries.filter((item) => item.kind === 'file').sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = entry.path.split('/'); const name = parts.pop() || entry.name; const parentPath = parts.join('/')
    ensureDir(root, directories, parentPath).children.push({ name, path: entry.path, kind: 'file', children: [] })
  }
  pruneEmptyDirectories(root)
  sortTree(root)
  return root.children
}

function ensureDir(root: TreeNode, map: Map<string, TreeNode>, path: string) {
  if (map.has(path)) return map.get(path)!
  let current = root; let built = ''
  for (const part of path.split('/').filter(Boolean)) {
    built = built ? `${built}/${part}` : part
    let child = map.get(built)
    if (!child) { child = { name: part, path: built, kind: 'directory', children: [] }; current.children.push(child); map.set(built, child) }
    current = child
  }
  return current
}

function pruneEmptyDirectories(node: TreeNode) {
  node.children = node.children.filter((child) => child.kind === 'file' || (pruneEmptyDirectories(child), child.children.length > 0))
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
  node.children.forEach(sortTree)
}

function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return 'Erro inesperado' }
