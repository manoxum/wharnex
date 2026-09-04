import { useEffect, useMemo, useRef, useState, type MouseEvent, type MutableRefObject } from 'react'
import type { FileEntry } from '../types'
import { Icon } from './Icon'

type TreeNode = { name: string; path: string; kind: 'file' | 'directory'; children: TreeNode[] }
type ContextMenu = { x: number; y: number; node: TreeNode }

export function WorkspaceExplorer({ entries, activePath, loading, revealNonce, onOpen, onRefresh, onCreate, onRename, onDelete }: {
  entries: FileEntry[]
  activePath?: string
  loading: boolean
  revealNonce: number
  onOpen: (path: string) => void
  onRefresh: () => Promise<void>
  onCreate: (path: string, kind: 'file' | 'directory') => Promise<void>
  onRename: (from: string, to: string) => Promise<void>
  onDelete: (path: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [focusedPath, setFocusedPath] = useState<string>()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<ContextMenu>()
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const fullTree = useMemo(() => buildTree(entries), [entries])
  const tree = useMemo(() => filterTree(fullTree, query.trim().toLowerCase()), [fullTree, query])
  const focused = useMemo(() => findNode(fullTree, focusedPath || activePath || ''), [fullTree, focusedPath, activePath])

  useEffect(() => {
    if (!activePath) return
    setFocusedPath(activePath)
    setExpanded((current) => withAncestors(current, activePath))
  }, [activePath])

  useEffect(() => {
    if (!revealNonce || !activePath) return
    setQuery('')
    setFocusedPath(activePath)
    setExpanded((current) => withAncestors(current, activePath))
    requestAnimationFrame(() => rowRefs.current.get(activePath)?.scrollIntoView({ block: 'center' }))
  }, [revealNonce, activePath])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(undefined)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [menu])

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  function parentForCreate() {
    if (focused?.kind === 'directory') return focused.path
    return parentPath(focused?.path || activePath || '')
  }

  async function create(kind: 'file' | 'directory') {
    const label = kind === 'file' ? 'Nome do novo ficheiro' : 'Nome da nova pasta'
    const name = window.prompt(label)
    if (!name) return
    const clean = cleanLeafName(name)
    if (!clean) return
    const parent = parentForCreate()
    const path = parent ? `${parent}/${clean}` : clean
    try { await onCreate(path, kind) } catch { return }
    setFocusedPath(path)
    setExpanded((current) => withAncestors(current, path))
    if (kind === 'file') onOpen(path)
  }

  async function rename(node = focused) {
    if (!node) return
    const name = window.prompt('Novo nome', node.name)
    if (!name || name === node.name) return
    const clean = cleanLeafName(name)
    if (!clean) return
    const parent = parentPath(node.path)
    const target = parent ? `${parent}/${clean}` : clean
    try { await onRename(node.path, target) } catch { return }
    setFocusedPath(target)
    setExpanded((current) => withAncestors(current, target))
  }

  async function remove(node = focused) {
    if (!node) return
    const detail = node.kind === 'directory' ? 'A pasta e todo o seu conteúdo serão removidos.' : 'O ficheiro será removido.'
    if (!window.confirm(`Eliminar “${node.path}”?\n\n${detail}`)) return
    try { await onDelete(node.path) } catch { return }
    setFocusedPath(parentPath(node.path) || undefined)
  }

  async function copyPath(node = focused) {
    if (!node) return
    await navigator.clipboard.writeText(node.path)
  }

  function contextMenu(event: MouseEvent, node: TreeNode) {
    event.preventDefault()
    event.stopPropagation()
    setFocusedPath(node.path)
    setMenu({ x: event.clientX, y: event.clientY, node })
  }

  return <aside className="file-explorer">
    <header>
      <div><span className="panel-kicker">Workspace</span><strong>Explorer</strong></div>
      <div className="explorer-toolbar">
        <button className="icon-button" title="Novo ficheiro" onClick={() => void create('file')}><Icon name="new-file" size={14}/></button>
        <button className="icon-button" title="Nova pasta" onClick={() => void create('directory')}><Icon name="new-folder" size={14}/></button>
        <button className="icon-button" title="Recolher todas as pastas" onClick={() => setExpanded(new Set())}><Icon name="collapse" size={14}/></button>
        <button className="icon-button" title="Atualizar ficheiros" onClick={() => void onRefresh()} disabled={loading}><Icon name="refresh" size={14}/></button>
      </div>
    </header>
    <div className="explorer-search"><Icon name="search" size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar no workspace…" aria-label="Pesquisar no workspace" />{query && <button title="Limpar pesquisa" onClick={() => setQuery('')}>×</button>}</div>
    {focused && <div className="explorer-selection" title={focused.path}><span>{focused.path}</span><div><button title="Copiar caminho" onClick={() => void copyPath()}><Icon name="copy" size={12}/></button><button title="Renomear (F2)" onClick={() => void rename()}><Icon name="rename" size={12}/></button><button className="danger" title="Eliminar" onClick={() => void remove()}><Icon name="trash" size={12}/></button></div></div>}
    <div className="file-tree" onKeyDown={(event) => {
      if (event.key === 'F2' && focused) { event.preventDefault(); void rename() }
      if (event.key === 'Delete' && focused) { event.preventDefault(); void remove() }
    }}>
      {tree.length ? tree.map((node) => <TreeItem key={node.path} node={node} activePath={activePath} focusedPath={focusedPath} expanded={expanded} onToggle={toggle} onOpen={onOpen} onFocus={setFocusedPath} onContextMenu={contextMenu} rowRefs={rowRefs} depth={0}/>) : <div className="explorer-empty">Nenhum caminho corresponde à pesquisa.</div>}
    </div>
    <footer className="explorer-footer"><span>{entries.filter((item) => item.kind === 'file').length} ficheiros</span><span>{entries.filter((item) => item.kind === 'directory').length} pastas</span></footer>
    {menu && <div className="explorer-context-menu" data-chatgpt-overlay-blocker="true" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {menu.node.kind === 'file' && <button onClick={() => { onOpen(menu.node.path); setMenu(undefined) }}><Icon name="file" size={13}/> Abrir</button>}
      <button onClick={() => { void copyPath(menu.node); setMenu(undefined) }}><Icon name="copy" size={13}/> Copiar caminho</button>
      <button onClick={() => { void rename(menu.node); setMenu(undefined) }}><Icon name="rename" size={13}/> Renomear</button>
      <div className="menu-separator"/>
      <button className="danger" onClick={() => { void remove(menu.node); setMenu(undefined) }}><Icon name="trash" size={13}/> Eliminar</button>
    </div>}
  </aside>
}

function TreeItem({ node, activePath, focusedPath, expanded, onToggle, onOpen, onFocus, onContextMenu, rowRefs, depth }: {
  node: TreeNode
  activePath?: string
  focusedPath?: string
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onFocus: (path: string) => void
  onContextMenu: (event: MouseEvent, node: TreeNode) => void
  rowRefs: MutableRefObject<Map<string, HTMLButtonElement>>
  depth: number
}) {
  const open = expanded.has(node.path)
  const bindRef = (element: HTMLButtonElement | null) => { if (element) rowRefs.current.set(node.path, element); else rowRefs.current.delete(node.path) }
  if (node.kind === 'directory') return <div className="tree-group">
    <button ref={bindRef} className={`tree-row folder-row ${focusedPath === node.path ? 'selected-node' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => { onFocus(node.path); onToggle(node.path) }} onContextMenu={(event) => onContextMenu(event, node)} title={node.path}><span className={`tree-chevron ${open ? 'open' : ''}`}><Icon name="chevron" size={12}/></span><Icon name="folder" size={14}/><span>{node.name}</span></button>
    {open && node.children.map((child) => <TreeItem key={child.path} node={child} activePath={activePath} focusedPath={focusedPath} expanded={expanded} onToggle={onToggle} onOpen={onOpen} onFocus={onFocus} onContextMenu={onContextMenu} rowRefs={rowRefs} depth={depth + 1}/>) }
  </div>
  return <button ref={bindRef} className={`tree-row file-row ${activePath === node.path ? 'active' : ''} ${focusedPath === node.path ? 'selected-node' : ''}`} style={{ paddingLeft: 25 + depth * 14 }} onClick={() => { onFocus(node.path); onOpen(node.path) }} onContextMenu={(event) => onContextMenu(event, node)} title={node.path}><Icon name="file" size={13}/><span>{node.name}</span></button>
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

function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    const child = findNode(node.children, path)
    if (child) return child
  }
  return undefined
}

function withAncestors(current: Set<string>, path: string) {
  const next = new Set(current)
  const parts = path.split('/')
  parts.pop()
  let built = ''
  for (const part of parts) { built = built ? `${built}/${part}` : part; next.add(built) }
  return next
}

function parentPath(path: string) {
  const index = path.lastIndexOf('/')
  return index > -1 ? path.slice(0, index) : ''
}

function cleanLeafName(value: string) {
  const clean = value.trim()
  if (!clean || clean === '.' || clean === '..' || clean.includes('/') || clean.includes('\\')) {
    window.alert('Use apenas o nome do ficheiro/pasta, sem /, \\ ou segmentos ..')
    return ''
  }
  return clean
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
  node.children.forEach(sortTree)
}
