import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { api, APIError } from '../../../lib/transport/http/api'
import { translate as uiText, formatMessage } from '../../../lib/workspace/localization'
import { useGitLiveRefresh } from '../../../lib/git/workflow/useGitLiveRefresh'
import { confirmDialog, promptDialog } from '../../../lib/desktop/bridge/appDialog'
import type { FileEntry, GitFileDiff, GitWorkingFile, Session } from '../../../types'
import { ContextMenu as WorkbenchContextMenu } from '../../presentation/menus'
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
  const dismissMenu = useCallback(() => setMenu(undefined), [])

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
      title: uiText(isFile ? 'Criar ficheiro' : 'Criar pasta'),
      message: formatMessage(isFile ? 'O novo ficheiro será criado dentro de {path}.' : 'A nova pasta será criada dentro de {path}.', { path: parentForCreate() || uiText('raiz do projeto') }),
      inputLabel: uiText(isFile ? 'Nome do ficheiro' : 'Nome da pasta'),
      placeholder: isFile ? 'exemplo.ts' : 'nova-pasta',
      confirmLabel: uiText('Criar'),
      validate: (value) => { const error = validateLeafName(value); return error ? uiText(error) : undefined },
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
      title: uiText(node.kind === 'file' ? 'Renomear ficheiro' : 'Renomear pasta'),
      message: formatMessage('O caminho atual é “{path}”. Rascunhos abertos no Editor serão preservados com o novo caminho.', { path: node.path }),
      inputLabel: uiText('Novo nome'),
      initialValue: node.name,
      confirmLabel: uiText('Renomear'),
      validate: (value) => { const error = validateLeafName(value); return error ? uiText(error) : undefined },
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
    const detail = uiText(node.kind === 'directory' ? 'A pasta e todo o conteúdo serão removidos.' : 'O ficheiro será removido.')
    if (!(await confirmDialog({
      title: uiText(node.kind === 'directory' ? 'Eliminar pasta?' : 'Eliminar ficheiro?'),
      message: formatMessage('“{path}” será removido. {detail} Separadores abertos neste caminho também serão fechados.', { path: node.path, detail }),
      tone: 'danger',
      confirmLabel: uiText('Eliminar'),
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

  return <section className="agent-project-explorer flex h-full min-h-0 flex-col bg-whx-bg text-whx-soft" aria-label={uiText('Explorador do projeto')}>
    <ProjectExplorerHeader projectPath={session.project_path} expanded={Boolean(expanded.size)} loading={loading} onCreateFile={() => void create('file')} onCreateFolder={() => void create('directory')} onCollapse={() => setExpanded(new Set())} onRefresh={() => void refresh()} onClose={onClose}/>
    <div className="flex h-7 shrink-0 items-center gap-3 border-b border-whx-border-soft px-3 text-[calc(10px*var(--ui-font-scale))] text-whx-faint">
      <span className="inline-flex items-center gap-1.5" title={uiText('Ficheiros visíveis no projeto')}><Icon name="file" size={12}/>{entries.filter((entry) => entry.kind === 'file').length}</span>
      <span className="ml-auto inline-flex items-center gap-1.5" role="group" aria-label={uiText('Resumo das alterações Git')} title={formatMessage('{count} ficheiros alterados', { count: gitFiles.length })}><Icon name="git" size={12}/><strong className="font-mono font-medium text-whx-soft">{gitFiles.length}<span className="sr-only"> alterados</span></strong>{gitFiles.length > 0 && <><span className="font-mono text-whx-success">+{gitTotals.additions}</span><span className="font-mono text-whx-danger">−{gitTotals.deletions}</span></>}</span>
    </div>
    <ProjectExplorerTree tree={tree} hiddenGitFiles={hiddenGitFiles} expanded={expanded} focusedPath={focusedPath} gitByPath={gitByPath} gitDirectoryCounts={gitDirectoryCounts} loading={loading} gitDiffLoadingPath={gitDiffLoadingPath} treeRef={treeRef} onKeyDown={(event) => {
      if (event.key === 'F2' && focused) { event.preventDefault(); void rename() }
      if (event.key === 'Delete' && focused) { event.preventDefault(); void remove() }
    }} onToggle={toggle} onOpen={onOpen} onFocus={setFocusedPath} onContextMenu={contextMenu} onOpenGitDiff={(path) => void openGitDiff(path)}/>
    {menu && <WorkbenchContextMenu x={menu.x} y={menu.y} label={formatMessage('Ações de {path}', { path: menu.node.path })} onClose={dismissMenu} actions={[
      ...(menu.node.kind === 'file' ? [{ id: 'open', label: uiText('Abrir no Editor'), icon: 'file' as const, run: () => onOpen(menu.node.path) }] : []),
      ...(canOpenGitDiff(gitByPath.get(menu.node.path)) ? [{ id: 'git', label: uiText('Ver alterações Git'), icon: 'git' as const, run: () => { void openGitDiff(menu.node.path) } }] : []),
      { id: 'copy', label: uiText('Copiar caminho'), icon: 'copy', run: () => { void copyPath(menu.node).catch((error) => onError(messageOf(error))) } },
      { id: 'rename', label: uiText('Renomear'), icon: 'rename', run: () => { void rename(menu.node) } },
      { id: 'delete', label: uiText('Eliminar'), icon: 'trash', separator: true, danger: true, run: () => { void remove(menu.node) } },
    ]}/>}
    {gitDiff && <div className="diff-inspector-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setGitDiff(undefined) }}><section className="diff-inspector editor-git-diff"><header><div><strong>{gitDiff.path}</strong><span>{uiText(gitDiff.truncated ? 'Diff truncado a 512 KiB.' : 'Alterações locais em relação ao HEAD.')}</span></div><button type="button" className="icon-button" onClick={() => setGitDiff(undefined)} aria-label={uiText('Fechar diff')} title={uiText('Fechar diff')}><Icon name="close" size={16}/></button></header>{gitDiffFile ? <ChangeDiffEditor sessionId={session.id} file={gitDiffFile}/> : null}</section></div>}
  </section>
}

function publishMutation(detail: WorkspaceMutation) { window.dispatchEvent(new CustomEvent('wharnex:workspace-files-changed', { detail })) }

function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return uiText('Erro inesperado') }
