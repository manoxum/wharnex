import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { api, APIError } from '../../../lib/transport/http/api'
import { confirmDialog, promptDialog } from '../../../lib/desktop/bridge/appDialog'
import type { FileEntry, GitFileDiff, GitWorkingFile, Session } from '../../../types'
import { DirectoryGlyph, FileGlyph } from '../../editor/canvas/FileGlyph'
import { Icon } from '../../presentation/chrome/Icon'
import { ContentSkeleton } from '../../presentation/chrome/Skeleton'
import { ChangeDiffEditor } from '../../editor/canvas/ChangeDiffEditor'

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
  const [gitFiles, setGitFiles] = useState<GitWorkingFile[]>([])
  const [gitDiff, setGitDiff] = useState<GitFileDiff>()
  const [gitDiffLoadingPath, setGitDiffLoadingPath] = useState<string>()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [focusedPath, setFocusedPath] = useState<string>()
  const [menu, setMenu] = useState<ContextMenu>()
  const [loading, setLoading] = useState(false)
  const treeRef = useRef<HTMLDivElement>(null)
  const fullTree = useMemo(() => buildTree(entries), [entries])
  const tree = fullTree
  const gitByPath = useMemo(() => new Map(gitFiles.map((file) => [file.path, file])), [gitFiles])
  const gitDirectoryCounts = useMemo(() => changedDirectoryCounts(gitFiles), [gitFiles])
  const hiddenGitFiles = useMemo(() => {
    const visible = new Set(entries.map((entry) => entry.path))
    return gitFiles.filter((file) => !visible.has(file.path))
  }, [entries, gitFiles])
  const gitTotals = useMemo(() => gitFiles.reduce((totals, file) => ({ additions: totals.additions + (file.additions || 0), deletions: totals.deletions + (file.deletions || 0) }), { additions: 0, deletions: 0 }), [gitFiles])
  const gitDiffFile = useMemo(() => gitDiff?.diff ? { path: gitDiff.path, additions: 0, deletions: 0, diff: gitDiff.diff } : undefined, [gitDiff?.path, gitDiff?.diff])
  const focused = useMemo(() => focusedPath ? findNode(fullTree, focusedPath) : undefined, [fullTree, focusedPath])

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try { setEntries((await api.listFiles(session.id)).files) }
    catch (error) { onError(messageOf(error)) }
    try {
      const overview = await api.gitOverview(session.id)
      setGitFiles(overview.available ? overview.working.files : [])
    } catch {
      setGitFiles([])
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [session.id, onError])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const sync = () => { if (document.visibilityState === 'visible') void refresh(false) }
    const timer = window.setInterval(sync, 4500)
    window.addEventListener('wharnex:git-working-tree-changed', sync)
    return () => { window.clearInterval(timer); window.removeEventListener('wharnex:git-working-tree-changed', sync) }
  }, [refresh])
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

  async function openGitDiff(path: string) {
    setGitDiffLoadingPath(path)
    try { setGitDiff(await api.gitFileDiff(session.id, path)) }
    catch (error) { onError(messageOf(error)) }
    finally { setGitDiffLoadingPath(undefined) }
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
        <button type="button" className="agent-drawer-icon" onClick={() => void create('file')} aria-label="Novo ficheiro" title="Novo ficheiro"><Icon name="new-file" size={16}/></button>
        <button type="button" className="agent-drawer-icon" onClick={() => void create('directory')} aria-label="Nova pasta" title="Nova pasta"><Icon name="new-folder" size={16}/></button>
        <button type="button" className="agent-drawer-icon" onClick={() => setExpanded(new Set())} disabled={!expanded.size} aria-label="Recolher todas as pastas" title="Recolher todas as pastas"><Icon name="collapse" size={16}/></button>
        <button type="button" className="agent-drawer-icon" onClick={() => void refresh()} disabled={loading} aria-label="Atualizar ficheiros" title="Atualizar ficheiros"><Icon name="refresh" size={16}/></button>
        <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar explorador" title="Fechar explorador"><Icon name="close" size={16}/></button>
      </div>
    </header>
    {gitFiles.length ? <div className="agent-project-git-summary" aria-label="Resumo das alterações Git"><span><Icon name="git" size={12}/>{gitFiles.length} alterado{gitFiles.length === 1 ? '' : 's'}</span><span className="git-lines-added">+{gitTotals.additions}</span><span className="git-lines-deleted">−{gitTotals.deletions}</span></div> : null}
    <div className="agent-project-tree" ref={treeRef} tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'F2' && focused) { event.preventDefault(); void rename() }
      if (event.key === 'Delete' && focused) { event.preventDefault(); void remove() }
    }}>
      {hiddenGitFiles.length ? <div className="agent-tree-hidden-git"><span>Fora da árvore</span>{hiddenGitFiles.map((file) => <button type="button" key={file.path} className={`agent-tree-row file git-changed git-${file.status} git-virtual`} onClick={() => void openGitDiff(file.path)} disabled={!canOpenGitDiff(file) || gitDiffLoadingPath === file.path} title={canOpenGitDiff(file) ? `Ver diff Git de ${file.path}` : `Diff inline indisponível para ${file.path}`}><FileGlyph path={file.path} size={15}/><span className="agent-tree-name">{file.path}</span><GitChangeBadge file={file}/></button>)}</div> : null}
      {loading && !entries.length ? <ContentSkeleton label="A carregar ficheiros do projeto" rows={7}/> : tree.length ? tree.map((node) => <TreeItem key={node.path} node={node} depth={0} expanded={expanded} focusedPath={focusedPath} gitByPath={gitByPath} gitDirectoryCounts={gitDirectoryCounts} onToggle={toggle} onOpen={onOpen} onFocus={setFocusedPath} onContextMenu={contextMenu}/>) : <div className="agent-drawer-empty">Este projeto não contém ficheiros visíveis no Explorer.</div>}
    </div>
    <footer className="agent-project-footer"><span>{entries.filter((entry) => entry.kind === 'file').length} ficheiros</span><span>{gitFiles.length ? `${gitFiles.length} com alterações Git` : 'Git limpo'}</span></footer>
    {menu && <div className="explorer-context-menu agent-explorer-context-menu" data-chatgpt-overlay-blocker="true" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {menu.node.kind === 'file' && <button type="button" onClick={() => { onOpen(menu.node.path); setMenu(undefined) }}><FileGlyph path={menu.node.path}/> Abrir no Editor</button>}
      {canOpenGitDiff(gitByPath.get(menu.node.path)) && <button type="button" onClick={() => { void openGitDiff(menu.node.path); setMenu(undefined) }}><Icon name="git" size={13}/> Ver alterações Git</button>}
      <button type="button" onClick={() => { void copyPath(menu.node); setMenu(undefined) }}><Icon name="copy" size={13}/> Copiar caminho</button>
      <button type="button" onClick={() => { void rename(menu.node); setMenu(undefined) }}><Icon name="rename" size={13}/> Renomear</button>
      <div className="menu-separator"/>
      <button type="button" className="danger" onClick={() => { void remove(menu.node); setMenu(undefined) }}><Icon name="trash" size={13}/> Eliminar</button>
    </div>}
    {gitDiff && <div className="diff-inspector-backdrop" data-chatgpt-overlay-blocker="true" onMouseDown={(event) => { if (event.currentTarget === event.target) setGitDiff(undefined) }}><section className="diff-inspector editor-git-diff"><header><div><strong>{gitDiff.path}</strong><span>{gitDiff.truncated ? 'Diff truncado a 512 KiB.' : 'Alterações locais em relação ao HEAD.'}</span></div><button type="button" className="icon-button" onClick={() => setGitDiff(undefined)} aria-label="Fechar diff" title="Fechar diff"><Icon name="close" size={16}/></button></header>{gitDiffFile ? <ChangeDiffEditor sessionId={session.id} file={gitDiffFile}/> : null}</section></div>}
  </section>
}

function TreeItem({ node, depth, expanded, focusedPath, gitByPath, gitDirectoryCounts, onToggle, onOpen, onFocus, onContextMenu }: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  focusedPath?: string
  gitByPath: Map<string, GitWorkingFile>
  gitDirectoryCounts: Map<string, number>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onFocus: (path: string) => void
  onContextMenu: (event: MouseEvent, node: TreeNode) => void
}) {
  const open = expanded.has(node.path)
  const fileGit = gitByPath.get(node.path)
  const nestedChanges = gitDirectoryCounts.get(node.path) || 0
  if (node.kind === 'directory') return <div className="agent-tree-group">
    <button type="button" className={`agent-tree-row folder${focusedPath === node.path ? ' selected-node' : ''}${nestedChanges ? ' git-has-changes' : ''}${fileGit ? ` git-changed git-${fileGit.status}` : ''}`} data-workspace-path={node.path} style={{ paddingLeft: 9 + depth * 13 }} onClick={() => onToggle(node.path)} onContextMenu={(event) => onContextMenu(event, node)} title={node.path}>
      <span className={`agent-tree-chevron ${open ? 'open' : ''}`}><Icon name="chevron" size={14}/></span><DirectoryGlyph path={node.path} size={15}/><span className="agent-tree-name">{node.name}</span>{nestedChanges ? <span className="agent-tree-git-count" title={`${nestedChanges} alteração${nestedChanges === 1 ? '' : 'ões'} dentro desta pasta`}>{nestedChanges}</span> : null}{fileGit ? <GitChangeBadge file={fileGit}/> : null}
    </button>
    {open && node.children.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} expanded={expanded} focusedPath={focusedPath} gitByPath={gitByPath} gitDirectoryCounts={gitDirectoryCounts} onToggle={onToggle} onOpen={onOpen} onFocus={onFocus} onContextMenu={onContextMenu}/>)}
  </div>
  return <button type="button" className={`agent-tree-row file${focusedPath === node.path ? ' selected-node' : ''}${fileGit ? ` git-changed git-${fileGit.status}` : ''}`} data-workspace-path={node.path} style={{ paddingLeft: 23 + depth * 13 }} onClick={() => { onFocus(node.path); onOpen(node.path) }} onContextMenu={(event) => onContextMenu(event, node)} title={`Abrir ${node.path}`} aria-label={`Abrir ${node.path}`}><FileGlyph path={node.path} size={15}/><span className="agent-tree-name">{node.name}</span>{fileGit ? <GitChangeBadge file={fileGit}/> : null}</button>
}


function canOpenGitDiff(file?: GitWorkingFile) {
  return Boolean(file && file.kind !== 'submodule' && file.kind !== 'embedded_repository')
}

function GitChangeBadge({ file }: { file: GitWorkingFile }) {
  const code = file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'unmerged' ? '!' : 'M'
  const label = file.status === 'added' ? 'Adicionado' : file.status === 'deleted' ? 'Removido' : file.status === 'unmerged' ? 'Conflito' : 'Modificado'
  return <span className={`agent-tree-git-status ${file.status}`} title={`${label} no Git · +${file.additions || 0} −${file.deletions || 0}`}><b>{code}</b>{file.additions ? <i className="git-lines-added">+{file.additions}</i> : null}{file.deletions ? <i className="git-lines-deleted">−{file.deletions}</i> : null}</span>
}

function changedDirectoryCounts(files: GitWorkingFile[]) {
  const counts = new Map<string, number>()
  for (const file of files) {
    const parts = file.path.split('/'); parts.pop()
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      counts.set(current, (counts.get(current) || 0) + 1)
    }
  }
  return counts
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
