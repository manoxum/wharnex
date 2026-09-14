import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, APIError } from '../lib/api'
import type { FileEntry, Session } from '../types'
import { Icon } from './Icon'

type TreeNode = { name: string; path: string; kind: 'file' | 'directory'; children: TreeNode[] }

export function AgentProjectExplorer({ session, onOpen, onError, onClose }: {
  session: Session
  onOpen: (path: string) => void
  onError: (message: string) => void
  onClose: () => void
}) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const fullTree = useMemo(() => buildTree(entries), [entries])
  const tree = useMemo(() => filterTree(fullTree, query.trim().toLowerCase()), [fullTree, query])

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setEntries((await api.listFiles(session.id)).files) }
    catch (error) { onError(messageOf(error)) }
    finally { setLoading(false) }
  }, [session.id, onError])

  useEffect(() => { void refresh() }, [refresh])

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  return <section className="agent-project-explorer" aria-label="Explorador do projeto">
    <header className="agent-drawer-heading">
      <div><span className="panel-kicker">Project</span><strong>{projectName(session.project_path)}</strong></div>
      {/* Every drawer closes from its own heading: the panel is dismissed only
          when the operator asks, so each one has to offer that control. */}
      <div className="agent-runtime-heading-actions">
        <button type="button" className="agent-drawer-icon" onClick={() => void refresh()} disabled={loading} aria-label="Atualizar ficheiros" title="Atualizar ficheiros"><Icon name="refresh" size={14}/></button>
        <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar explorador" title="Fechar explorador"><Icon name="close" size={13}/></button>
      </div>
    </header>
    <label className="agent-explorer-search">
      <Icon name="search" size={13}/>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar no projeto" aria-label="Pesquisar ficheiros" />
      {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><Icon name="close" size={11}/></button>}
    </label>
    <div className="agent-project-tree">
      {loading && !entries.length ? <div className="agent-drawer-empty">A carregar ficheiros…</div> : tree.length ? tree.map((node) => <TreeItem key={node.path} node={node} depth={0} expanded={expanded} onToggle={toggle} onOpen={onOpen}/>) : <div className="agent-drawer-empty">Nenhum caminho corresponde à pesquisa.</div>}
    </div>
    <footer className="agent-project-footer"><span>{entries.filter((entry) => entry.kind === 'file').length} ficheiros</span><span>edição no Agent</span></footer>
  </section>
}

function TreeItem({ node, depth, expanded, onToggle, onOpen }: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
}) {
  const open = expanded.has(node.path)
  if (node.kind === 'directory') return <div className="agent-tree-group">
    <button type="button" className="agent-tree-row folder" style={{ paddingLeft: 9 + depth * 13 }} onClick={() => onToggle(node.path)} title={node.path}>
      <span className={`agent-tree-chevron ${open ? 'open' : ''}`}><Icon name="chevron" size={11}/></span><Icon name="folder" size={13}/><span>{node.name}</span>
    </button>
    {open && node.children.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpen={onOpen}/>) }
  </div>
  return <button type="button" className="agent-tree-row file" style={{ paddingLeft: 23 + depth * 13 }} onClick={() => onOpen(node.path)} title={`Abrir ${node.path}`} aria-label={`Abrir ${node.path}`}><Icon name="file" size={12}/><span>{node.name}</span></button>
}

function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'directory', children: [] }
  const directories = new Map<string, TreeNode>([['', root]])
  for (const entry of entries.filter((item) => item.kind === 'directory').sort((a, b) => a.path.localeCompare(b.path))) ensureDir(root, directories, entry.path)
  for (const entry of entries.filter((item) => item.kind === 'file').sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = entry.path.split('/'); const name = parts.pop() || entry.name; const parent = parts.join('/')
    ensureDir(root, directories, parent).children.push({ name, path: entry.path, kind: 'file', children: [] })
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

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes
  const visit = (node: TreeNode): TreeNode | undefined => {
    const children = node.children.map(visit).filter((child): child is TreeNode => Boolean(child))
    if (node.path.toLowerCase().includes(query) || children.length) return { ...node, children }
    return undefined
  }
  return nodes.map(visit).filter((node): node is TreeNode => Boolean(node))
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
  node.children.forEach(sortTree)
}

function projectName(path: string) { return path.split('/').filter(Boolean).at(-1) || path }
function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return 'Erro inesperado' }
