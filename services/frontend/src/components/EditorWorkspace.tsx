import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, APIError } from '../lib/api'
import { parseArgv } from '../lib/shell'
import type { CommandResult, FileEntry, Session, WorkspaceFile } from '../types'
import { Icon } from './Icon'

export function EditorWorkspace({ session, onError }: { session: Session; onError: (message: string) => void }) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<WorkspaceFile>()
  const [draft, setDraft] = useState('')
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [saving, setSaving] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(245)
  const dirty = selected ? draft !== selected.content : false

  const refreshFiles = useCallback(async () => {
    setLoadingFiles(true)
    try { setFiles((await api.listFiles(session.id)).files) }
    catch (error) { onError(messageOf(error)) }
    finally { setLoadingFiles(false) }
  }, [session.id, onError])

  useEffect(() => { void refreshFiles() }, [refreshFiles])

  async function openFile(path: string) {
    if (dirty && !window.confirm('Existem alterações não guardadas. Abrir outro ficheiro mesmo assim?')) return
    try {
      const file = await api.readFile(session.id, path)
      setSelected(file); setDraft(file.content)
    } catch (error) { onError(messageOf(error)) }
  }

  async function save() {
    if (!selected || !dirty) return
    setSaving(true)
    try {
      const saved = await api.writeFile(session.id, { path: selected.path, content: draft, sha256: selected.sha256 })
      setSelected(saved); setDraft(saved.content)
      await refreshFiles()
    } catch (error) { onError(messageOf(error)) }
    finally { setSaving(false) }
  }

  return <section className="editor-workspace">
    <FileExplorer entries={files} selected={selected?.path} loading={loadingFiles} onOpen={openFile} onRefresh={refreshFiles} />
    <div className="editor-main">
      <div className="editor-area">
        {selected ? <>
          <div className="editor-tabbar">
            <div className="editor-tab active"><Icon name="file" size={14}/><span>{selected.path}</span>{dirty && <i className="dirty-dot"/>}</div>
            <button className="editor-save" disabled={!dirty || saving} onClick={save} title="Guardar (Ctrl+S)"><Icon name="save" size={15}/>{saving ? 'A guardar…' : 'Guardar'}</button>
          </div>
          <textarea className="code-editor" value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() } }} />
          <div className="editor-statusbar"><span>{selected.path}</span><span>{selected.size.toLocaleString()} bytes · UTF-8</span></div>
        </> : <div className="editor-empty"><div className="empty-mark">&lt;/&gt;</div><h3>Escolha um ficheiro</h3><p>O Explorer mostra apenas ficheiros permitidos pela política de contexto do Harness. Ficheiros sensíveis e symlinks ficam fora do editor.</p></div>}
      </div>
      <div className="terminal-resizer" title="Ajustar terminal" onDoubleClick={() => setTerminalHeight(245)} />
      <TerminalPanel session={session} height={terminalHeight} onHeight={setTerminalHeight} onError={onError} />
    </div>
  </section>
}

type TreeNode = { name: string; path: string; kind: 'file' | 'directory'; children: TreeNode[] }

function FileExplorer({ entries, selected, loading, onOpen, onRefresh }: { entries: FileEntry[]; selected?: string; loading: boolean; onOpen: (path: string) => void; onRefresh: () => Promise<void> }) {
  const tree = useMemo(() => buildTree(entries), [entries])
  return <aside className="file-explorer">
    <header><div><span className="panel-kicker">Workspace</span><strong>Explorer</strong></div><button className="icon-button" title="Atualizar ficheiros" onClick={() => void onRefresh()} disabled={loading}><Icon name="refresh" size={15}/></button></header>
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
  for (const entry of entries.filter((item) => item.kind === 'directory').sort((a, b) => a.path.localeCompare(b.path))) {
    ensureDir(root, directories, entry.path)
  }
  for (const entry of entries.filter((item) => item.kind === 'file').sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = entry.path.split('/'); const name = parts.pop() || entry.name; const parentPath = parts.join('/')
    const parent = ensureDir(root, directories, parentPath)
    parent.children.push({ name, path: entry.path, kind: 'file', children: [] })
  }
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

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
  node.children.forEach(sortTree)
}

type TerminalEntry = { id: string; command: string; cwd: string; result?: CommandResult; error?: string }

function TerminalPanel({ session, height, onHeight, onError }: { session: Session; height: number; onHeight: (value: number) => void; onError: (message: string) => void }) {
  const [input, setInput] = useState('')
  const [cwd, setCwd] = useState('.')
  const [network, setNetwork] = useState(false)
  const [running, setRunning] = useState(false)
  const [entries, setEntries] = useState<TerminalEntry[]>([])

  async function execute() {
    const raw = input.trim(); if (!raw || running) return
    setInput('')
    if (raw === 'clear') { setEntries([]); return }
    let argv: string[]
    try { argv = parseArgv(raw) } catch (error) { onError(messageOf(error)); return }
    if (!argv.length) return
    if (argv[0] === 'cd') {
      const next = normalizeCwd(cwd, argv[1] || '.')
      setCwd(next); setEntries((items) => [...items, { id: crypto.randomUUID(), command: raw, cwd, result: { argv, cwd, exit_code: 0, stdout: '', stderr: '', duration_ms: 0, success: true } }]); return
    }
    const id = crypto.randomUUID(); setEntries((items) => [...items, { id, command: raw, cwd }]); setRunning(true)
    try {
      const result = await api.terminal(session.id, { argv, cwd, network, timeout_seconds: 300, expected_exit_codes: [0] })
      setEntries((items) => items.map((item) => item.id === id ? { ...item, result } : item))
    } catch (error) {
      const message = messageOf(error); setEntries((items) => items.map((item) => item.id === id ? { ...item, error: message } : item))
    } finally { setRunning(false) }
  }

  async function reset() {
    try { await api.resetTerminal(session.id); setEntries([]); setCwd('.') }
    catch (error) { onError(messageOf(error)) }
  }

  return <section className="ide-terminal" style={{ height }}>
    <header><div><Icon name="terminal" size={14}/><strong>Terminal sandbox</strong><span>{cwd}</span></div><div className="terminal-controls"><label title="Permitir rede no próximo comando"><input type="checkbox" checked={network} onChange={(e) => setNetwork(e.target.checked)}/><Icon name="network" size={13}/> rede</label><button className="icon-button" title="Recriar sandbox a partir do host" onClick={() => void reset()}><Icon name="reset" size={14}/></button><button className="terminal-size-button" title="Aumentar/reduzir terminal" onClick={() => onHeight(height < 320 ? 390 : 245)}>↕</button></div></header>
    <div className="terminal-scroll">
      {entries.map((entry) => <div className="ide-terminal-entry" key={entry.id}><div className="terminal-prompt"><span>wharness:{entry.cwd}$</span> {entry.command}</div>{entry.result?.stdout && <pre>{entry.result.stdout}</pre>}{entry.result?.stderr && <pre className="stderr">{entry.result.stderr}</pre>}{entry.result && entry.result.exit_code !== 0 && <span className="terminal-exit">exit {entry.result.exit_code}</span>}{entry.error && <pre className="stderr">{entry.error}</pre>}</div>)}
      {!entries.length && <div className="terminal-hint">Comandos são executados como argv dentro da sandbox Docker persistente. Sem shell implícito. `cd` e `clear` são tratados pelo editor.</div>}
    </div>
    <div className="terminal-input-row"><span>wharness:{cwd}$</span><input value={input} disabled={running} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void execute() }} spellCheck={false} autoComplete="off" placeholder={running ? 'a executar…' : 'go test ./...'} /></div>
  </section>
}

function normalizeCwd(current: string, next: string) {
  const parts = (next.startsWith('/') ? next.slice(1) : `${current === '.' ? '' : current}/${next}`).split('/')
  const stack: string[] = []
  for (const part of parts) { if (!part || part === '.') continue; if (part === '..') { stack.pop(); continue } ; stack.push(part) }
  return stack.length ? stack.join('/') : '.'
}

function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return 'Erro inesperado' }
