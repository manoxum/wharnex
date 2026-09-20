import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { api, APIError } from '../lib/api'
import { confirmDialog, promptDialog } from '../lib/appDialog'
import type { FileEntry, Session } from '../types'
import { DirectoryGlyph, FileGlyph } from './FileGlyph'
import { Icon } from './Icon'

type TreeNode = { name: string; path: string; kind: 'file' | 'directory'; children: TreeNode[] }
type ContextMenu = { x: number; y: number; node: TreeNode }
type WorkspaceMutation = { kind: 'create'; path: string } | { kind: 'rename'; from: string; to: string } | { kind: 'delete'; path: string }

export function AgentProjectExplorer({ session, onOpen, onError, onClose, revealPath, revealNonce = 0 }: {
  session: Session
  onOpen: (path: string) => void
  onError: (message: string) => void
  onClose: () => void
  revealPath?: string
  revealNonce?: number
}) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [focusedPath, setFocusedPath] = useState<string>()
  const [menu, setMenu] = useState<ContextMenu>()
  const [loading, setLoading] = useState(false)
  const treeRef = useRef<HTMLDivElement>(null)
  const fullTree = useMemo(() => buildTree(entries), [entries])
  const tree = fullTree
  const focused = useMemo(() => focusedPath ? findNode(fullTree, focusedPath) : undefined, [fullTree, focusedPath])

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setEntries((await api.listFiles(session.id)).files) }
    catch (error) { onError(messageOf(error)) }
    finally { setLoading(false) }
  }, [session.id, onError])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!revealPath || !findNode(fullTree, revealPath)) return
    setFocusedPath(revealPath)
    setExpanded((current) => withAncestors(current, revealPath))
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const row = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-workspace-path]') || [])].find((item) => item.dataset.workspacePath === revealPath)
      row?.scrollIntoView({ block: 'center' })
      row?.focus({ preventScroll: true })
    }))
  }, [fullTree, revealNonce, revealPath])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(undefined)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  function toggle(path: string) {
    setFocusedPath(path)
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  function parentForCreate() {
    if (!focused) return ''
    return focused.kind === 'directory' ? focused.path : parentPath(focused.path)
  }

  async function create(kind: 'file' | 'directory') {
    const isFile = kind === 'file'
    const clean = await promptDialog({
      title: isFile ? 'Criar ficheiro' : 'Criar pasta',
      message: `O novo ${isFile ? 'ficheiro' : 'diretório'} será criado dentro de ${parentForCreate() || 'raiz do projeto'}.`,
      inputLabel: isFile ? 'Nome do ficheiro' : 'Nome da pasta',
      placeholder: isFile ? 'exemplo.ts' : 'nova-pasta',
      confirmLabel: 'Criar',
      validate: validateLeafName,
    })
    if (!clean) return
    const parent = parentForCreate()
    const path = parent ? `${parent}/${clean}` : clean
    try {
      await api.createWorkspacePath(session.id, path, kind)
      await refresh()
      publishMutation({ kind: 'create', path })
      setFocusedPath(path)
      setExpanded((current) => withAncestors(current, path))
      if (kind === 'file') onOpen(path)
    } catch (error) { onError(messageOf(error)) }
  }

  async function rename(node = focused) {
    if (!node) return
    const clean = await promptDialog({
      title: node.kind === 'file' ? 'Renomear ficheiro' : 'Renomear pasta',
      message: `O caminho atual é “${node.path}”. Rascunhos abertos no Editor serão preservados com o novo caminho.`,
      inputLabel: 'Novo nome',
      initialValue: node.name,
      confirmLabel: 'Renomear',
      validate: validateLeafName,
    })
    if (!clean || clean === node.name) return
    const parent = parentPath(node.path)
    const target = parent ? `${parent}/${clean}` : clean
    try {
      await api.renameWorkspacePath(session.id, node.path, target)
      publishMutation({ kind: 'rename', from: node.path, to: target })
      await refresh()
      setFocusedPath(target)
      setExpanded((current) => withAncestors(current, target))
    } catch (error) { onError(messageOf(error)) }
  }

  async function remove(node = focused) {
    if (!node) return
    const detail = node.kind === 'directory' ? 'A pasta e todo o conteúdo serão removidos.' : 'O ficheiro será removido.'
    if (!(await confirmDialog({
      title: node.kind === 'directory' ? 'Eliminar pasta?' : 'Eliminar ficheiro?',
      message: `“${node.path}” será removido. ${detail} Tabs abertas nesse caminho também serão fechadas.`,
      tone: 'danger',
      confirmLabel: 'Eliminar',
    }))) return
    try {
      await api.deleteWorkspacePath(session.id, node.path)
      publishMutation({ kind: 'delete', path: node.path })
      await refresh()
      setFocusedPath(parentPath(node.path) || undefined)
    } catch (error) { onError(messageOf(error)) }
  }

  async function copyPath(node = focused) {
    if (!node) return
    await navigator.clipboard.writeText(node.path)
  }

  function contextMenu(event: MouseEvent, node: TreeNode) {
    event.preventDefault(); event.stopPropagation()
    setFocusedPath(node.path)
    setMenu({ x: event.clientX, y: event.clientY, node })
  }

  return <section className="agent-project-explorer" aria-label="Explorador do projeto">
    <header className="agent-drawer-heading">
      <div><span className="panel-kicker">Workspace</span><strong>Explorer</strong></div>
      <div className="agent-runtime-heading-actions">
        <button type="button" className="agent-drawer-icon" onClick={() => void create('file')} aria-label="Novo ficheiro" title="Novo ficheiro"><Icon name="new-file" size={14}/></button>
        <button type="button" className="agent-drawer-icon" onClick={() => void create('directory')} aria-label="Nova pasta" title="Nova pasta"><Icon name="new-folder" size={14}/></button>
        <button type="button" className="agent-drawer-icon" onClick={() => setExpanded(new Set())} disabled={!expanded.size} aria-label="Recolher todas as pastas" title="Recolher todas as pastas"><Icon name="collapse" size={14}/></button>
        <button type="button" className="agent-drawer-icon" onClick={() => void refresh()} disabled={loading} aria-label="Atualizar ficheiros" title="Atualizar ficheiros"><Icon name="refresh" size={14}/></button>
        <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar explorador" title="Fechar explorador"><Icon name="close" size={13}/></button>
      </div>
    </header>
    <div className="agent-project-tree" ref={treeRef} tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'F2' && focused) { event.preventDefault(); void rename() }
      if (event.key === 'Delete' && focused) { event.preventDefault(); void remove() }
    }}>
      {loading && !entries.length ? <div className="agent-drawer-empty">A carregar ficheiros…</div> : tree.length ? tree.map((node) => <TreeItem key={node.path} node={node} depth={0} expanded={expanded} focusedPath={focusedPath} onToggle={toggle} onOpen={onOpen} onFocus={setFocusedPath} onContextMenu={contextMenu}/>) : <div className="agent-drawer-empty">Este projeto não contém ficheiros visíveis no Explorer.</div>}
    </div>
    <footer className="agent-project-footer"><span>{entries.filter((entry) => entry.kind === 'file').length} ficheiros</span><span>explorador único</span></footer>
    {menu && <div className="explorer-context-menu agent-explorer-context-menu" data-chatgpt-overlay-blocker="true" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {menu.node.kind === 'file' && <button type="button" onClick={() => { onOpen(menu.node.path); setMenu(undefined) }}><FileGlyph path={menu.node.path}/> Abrir no Editor</button>}
      <button type="button" onClick={() => { void copyPath(menu.node); setMenu(undefined) }}><Icon name="copy" size={13}/> Copiar caminho</button>
      <button type="button" onClick={() => { void rename(menu.node); setMenu(undefined) }}><Icon name="rename" size={13}/> Renomear</button>
      <div className="menu-separator"/>
      <button type="button" className="danger" onClick={() => { void remove(menu.node); setMenu(undefined) }}><Icon name="trash" size={13}/> Eliminar</button>
    </div>}
  </section>
}

function TreeItem({ node, depth, expanded, focusedPath, onToggle, onOpen, onFocus, onContextMenu }: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  focusedPath?: string
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onFocus: (path: string) => void
  onContextMenu: (event: MouseEvent, node: TreeNode) => void
}) {
  const open = expanded.has(node.path)
  if (node.kind === 'directory') return <div className="agent-tree-group">
    <button type="button" className={`agent-tree-row folder${focusedPath === node.path ? ' selected-node' : ''}`} data-workspace-path={node.path} style={{ paddingLeft: 9 + depth * 13 }} onClick={() => onToggle(node.path)} onContextMenu={(event) => onContextMenu(event, node)} title={node.path}>
      <span className={`agent-tree-chevron ${open ? 'open' : ''}`}><Icon name="chevron" size={11}/></span><DirectoryGlyph path={node.path}/><span>{node.name}</span>
    </button>
    {open && node.children.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} expanded={expanded} focusedPath={focusedPath} onToggle={onToggle} onOpen={onOpen} onFocus={onFocus} onContextMenu={onContextMenu}/>) }
  </div>
  return <button type="button" className={`agent-tree-row file${focusedPath === node.path ? ' selected-node' : ''}`} data-workspace-path={node.path} style={{ paddingLeft: 23 + depth * 13 }} onClick={() => { onFocus(node.path); onOpen(node.path) }} onContextMenu={(event) => onContextMenu(event, node)} title={`Abrir ${node.path}`} aria-label={`Abrir ${node.path}`}><FileGlyph path={node.path}/><span>{node.name}</span></button>
}

function publishMutation(detail: WorkspaceMutation) { window.dispatchEvent(new CustomEvent('wharnex:workspace-files-changed', { detail })) }

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
  const parts = path.split('/'); parts.pop()
  let built = ''
  for (const part of parts) { built = built ? `${built}/${part}` : part; next.add(built) }
  return next
}

function parentPath(path: string) { const index = path.lastIndexOf('/'); return index > -1 ? path.slice(0, index) : '' }
function validateLeafName(value: string) {
  const clean = value.trim()
  if (!clean) return 'Introduza um nome.'
  if (clean === '.' || clean === '..' || clean.includes('/') || clean.includes('\\')) return 'Use apenas o nome do ficheiro/pasta, sem /, \\ ou segmentos ..'
  return undefined
}
function sortTree(node: TreeNode) { node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1); node.children.forEach(sortTree) }
function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return 'Erro inesperado' }
