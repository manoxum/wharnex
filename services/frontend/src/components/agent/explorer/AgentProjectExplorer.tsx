import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { api, APIError } from '../../../lib/transport/http/api'
import { useGitLiveRefresh } from '../../../lib/git/workflow/useGitLiveRefresh'
import { confirmDialog, promptDialog } from '../../../lib/desktop/bridge/appDialog'
import type { FileEntry, GitFileDiff, GitWorkingFile, Session } from '../../../types'
import { FileGlyph } from '../../editor/canvas/FileGlyph'
import { Icon } from '../../presentation/chrome/Icon'
import { ChangeDiffEditor } from '../../editor/canvas/ChangeDiffEditor'
import { ProjectExplorerHeader } from './ProjectExplorerHeader'
import { ProjectExplorerTree } from './ProjectExplorerTree'
import { buildTree, canOpenGitDiff, changedDirectoryCounts, findNode, parentPath, validateLeafName, withAncestors, type ContextMenu, type TreeNode, type WorkspaceMutation } from './projectExplorerModel'

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
  const tree = useMemo(() => buildTree(entries), [entries])
  const gitByPath = useMemo(() => new Map(gitFiles.map((file) => [file.path, file])), [gitFiles])
  const gitDirectoryCounts = useMemo(() => changedDirectoryCounts(gitFiles), [gitFiles])
  const hiddenGitFiles = useMemo(() => {
    const visible = new Set(entries.map((entry) => entry.path))
    return gitFiles.filter((file) => !visible.has(file.path))
  }, [entries, gitFiles])
  const gitTotals = useMemo(() => gitFiles.reduce((totals, file) => ({ additions: totals.additions + (file.additions || 0), deletions: totals.deletions + (file.deletions || 0) }), { additions: 0, deletions: 0 }), [gitFiles])
  const gitDiffFile = useMemo(() => gitDiff?.diff ? { path: gitDiff.path, additions: 0, deletions: 0, diff: gitDiff.diff } : undefined, [gitDiff?.path, gitDiff?.diff])
  const focused = useMemo(() => focusedPath ? findNode(tree, focusedPath) : undefined, [tree, focusedPath])

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
  const refreshQuietly = useCallback(() => refresh(false), [refresh])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const sync = () => { if (document.visibilityState === 'visible') void refreshQuietly() }
    window.addEventListener('wharnex:git-working-tree-changed', sync)
    return () => window.removeEventListener('wharnex:git-working-tree-changed', sync)
  }, [refreshQuietly])
  useGitLiveRefresh(session.id, refreshQuietly)
  useEffect(() => {
    if (!revealPath || !findNode(tree, revealPath)) return
    setFocusedPath(revealPath)
    setExpanded((current) => withAncestors(current, revealPath))
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const row = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-workspace-path]') || [])].find((item) => item.dataset.workspacePath === revealPath)
      row?.scrollIntoView({ block: 'center' })
      row?.focus({ preventScroll: true })
    }))
  }, [tree, revealNonce, revealPath])
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

  return <section className="agent-project-explorer flex h-full min-h-0 flex-col bg-whx-bg text-whx-soft" aria-label="Explorador do projeto">
    <ProjectExplorerHeader projectPath={session.project_path} expanded={Boolean(expanded.size)} loading={loading} onCreateFile={() => void create('file')} onCreateFolder={() => void create('directory')} onCollapse={() => setExpanded(new Set())} onRefresh={() => void refresh()} onClose={onClose}/>
    {gitFiles.length ? <div className="flex min-h-[30px] shrink-0 items-center gap-2 border-b border-whx-border-soft px-3 text-[calc(10px*var(--ui-font-scale))] text-whx-faint" role="group" aria-label="Resumo das alterações Git" title={`${gitFiles.length} ficheiros alterados`}><span className="inline-flex items-center gap-1.5 text-whx-soft"><Icon name="git" size={13}/><strong className="font-mono text-[calc(10px*var(--ui-font-scale))]">{gitFiles.length}<span className="sr-only"> alterados</span></strong></span><span className="font-mono text-[calc(9px*var(--ui-font-scale))] text-whx-success">+{gitTotals.additions}</span><span className="font-mono text-[calc(9px*var(--ui-font-scale))] text-whx-danger">−{gitTotals.deletions}</span></div> : null}
    <ProjectExplorerTree tree={tree} hiddenGitFiles={hiddenGitFiles} expanded={expanded} focusedPath={focusedPath} gitByPath={gitByPath} gitDirectoryCounts={gitDirectoryCounts} loading={loading} gitDiffLoadingPath={gitDiffLoadingPath} treeRef={treeRef} onKeyDown={(event) => {
      if (event.key === 'F2' && focused) { event.preventDefault(); void rename() }
      if (event.key === 'Delete' && focused) { event.preventDefault(); void remove() }
    }} onToggle={toggle} onOpen={onOpen} onFocus={setFocusedPath} onContextMenu={contextMenu} onOpenGitDiff={(path) => void openGitDiff(path)}/>
    <footer className="flex min-h-[30px] shrink-0 items-center justify-between gap-2 border-t border-whx-border-soft bg-whx-surface px-3 text-[calc(9px*var(--ui-font-scale))] text-whx-faint"><span className="inline-flex items-center gap-1.5" role="group" aria-label={`${entries.filter((entry) => entry.kind === 'file').length} ficheiros no projeto`} title="Ficheiros no projeto"><Icon name="file" size={12}/>{entries.filter((entry) => entry.kind === 'file').length}</span><span className="inline-flex items-center gap-1.5" role="group" aria-label={gitFiles.length ? `${gitFiles.length} ficheiros com alterações Git` : 'Git limpo'} title={gitFiles.length ? 'Ficheiros com alterações Git' : 'Git limpo'}><Icon name="git" size={12}/>{gitFiles.length || 'OK'}</span></footer>
    {menu && <div className="explorer-context-menu agent-explorer-context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {menu.node.kind === 'file' && <button type="button" onClick={() => { onOpen(menu.node.path); setMenu(undefined) }}><FileGlyph path={menu.node.path}/> Abrir no Editor</button>}
      {canOpenGitDiff(gitByPath.get(menu.node.path)) && <button type="button" onClick={() => { void openGitDiff(menu.node.path); setMenu(undefined) }}><Icon name="git" size={13}/> Ver alterações Git</button>}
      <button type="button" onClick={() => { void copyPath(menu.node); setMenu(undefined) }}><Icon name="copy" size={13}/> Copiar caminho</button>
      <button type="button" onClick={() => { void rename(menu.node); setMenu(undefined) }}><Icon name="rename" size={13}/> Renomear</button>
      <div className="menu-separator"/>
      <button type="button" className="danger" onClick={() => { void remove(menu.node); setMenu(undefined) }}><Icon name="trash" size={13}/> Eliminar</button>
    </div>}
    {gitDiff && <div className="diff-inspector-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setGitDiff(undefined) }}><section className="diff-inspector editor-git-diff"><header><div><strong>{gitDiff.path}</strong><span>{gitDiff.truncated ? 'Diff truncado a 512 KiB.' : 'Alterações locais em relação ao HEAD.'}</span></div><button type="button" className="icon-button" onClick={() => setGitDiff(undefined)} aria-label="Fechar diff" title="Fechar diff"><Icon name="close" size={16}/></button></header>{gitDiffFile ? <ChangeDiffEditor sessionId={session.id} file={gitDiffFile}/> : null}</section></div>}
  </section>
}

function publishMutation(detail: WorkspaceMutation) { window.dispatchEvent(new CustomEvent('wharnex:workspace-files-changed', { detail })) }

function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return 'Erro inesperado' }
