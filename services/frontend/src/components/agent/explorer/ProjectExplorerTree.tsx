import type { KeyboardEvent, MouseEvent, Ref } from 'react'
import type { GitWorkingFile } from '../../../types'
import { DirectoryGlyph, FileGlyph } from '../../editor/canvas/FileGlyph'
import { Icon } from '../../presentation/chrome/Icon'
import { ContentSkeleton } from '../../presentation/chrome/Skeleton'
import { canOpenGitDiff, type TreeNode } from './projectExplorerModel'

export function ProjectExplorerTree({ tree, hiddenGitFiles, expanded, focusedPath, gitByPath, gitDirectoryCounts, loading, gitDiffLoadingPath, treeRef, onKeyDown, onToggle, onOpen, onFocus, onContextMenu, onOpenGitDiff }: {
  tree: TreeNode[]
  hiddenGitFiles: GitWorkingFile[]
  expanded: Set<string>
  focusedPath?: string
  gitByPath: Map<string, GitWorkingFile>
  gitDirectoryCounts: Map<string, number>
  loading: boolean
  gitDiffLoadingPath?: string
  treeRef: Ref<HTMLDivElement>
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onFocus: (path: string) => void
  onContextMenu: (event: MouseEvent, node: TreeNode) => void
  onOpenGitDiff: (path: string) => void
}) {
  return <div className="agent-project-tree min-h-0 flex-1 overflow-auto bg-whx-bg px-1 py-1.5 [&_.file-glyph>svg]:size-[15px]" ref={treeRef} tabIndex={0} onKeyDown={onKeyDown}>
    {hiddenGitFiles.length ? <div className="agent-tree-hidden-git"><span>Fora da árvore</span>{hiddenGitFiles.map((file) => <button type="button" key={file.path} className={`agent-tree-row relative flex h-[28px] w-full items-center gap-1.5 border-0 border-l-2 border-l-transparent bg-transparent px-2 pr-2 text-left text-whx-soft transition-colors hover:bg-whx-hover hover:text-whx-text git-changed git-${file.status} git-virtual disabled:opacity-40`} onClick={() => onOpenGitDiff(file.path)} disabled={!canOpenGitDiff(file) || gitDiffLoadingPath === file.path} title={canOpenGitDiff(file) ? `Ver diff Git de ${file.path}` : `Diff inline indisponível para ${file.path}`}><FileGlyph path={file.path} size={15}/><span className="agent-tree-name min-w-0 flex-1 truncate text-[calc(11px*var(--ui-font-scale))] leading-tight">{file.path}</span><GitChangeBadge file={file}/></button>)}</div> : null}
    {loading && !tree.length ? <ContentSkeleton label="A carregar ficheiros do projeto" rows={7}/> : tree.length ? tree.map((node) => <TreeItem key={node.path} node={node} depth={0} expanded={expanded} focusedPath={focusedPath} gitByPath={gitByPath} gitDirectoryCounts={gitDirectoryCounts} onToggle={onToggle} onOpen={onOpen} onFocus={onFocus} onContextMenu={onContextMenu}/>) : <div className="grid min-h-32 place-items-center px-4 text-center text-[calc(10px*var(--ui-font-scale))] text-whx-faint">Este projeto não contém ficheiros visíveis no Explorer.</div>}
  </div>
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
  const selected = focusedPath === node.path
  const rowClass = `agent-tree-row group/tree-row relative flex h-[28px] w-full items-center gap-1.5 border-0 border-l-2 px-2 pr-2 text-left transition-colors ${selected ? 'border-l-[color:var(--theme-tab-active)] bg-whx-selection text-whx-text' : 'border-l-transparent bg-transparent text-whx-soft hover:bg-whx-hover hover:text-whx-text'}`
  if (node.kind === 'directory') return <div className="agent-tree-group">
    <button type="button" className={`${rowClass} font-medium${nestedChanges ? ' git-has-changes' : ''}${fileGit ? ` git-changed git-${fileGit.status}` : ''}`} data-workspace-path={node.path} data-selected={selected} style={{ paddingLeft: 9 + depth * 13 }} onClick={() => onToggle(node.path)} onContextMenu={(event) => onContextMenu(event, node)} title={node.path}>
      <span className={`grid size-4 shrink-0 place-items-center text-whx-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`}><Icon name="chevron" size={14}/></span><DirectoryGlyph path={node.path} size={15}/><span className="agent-tree-name min-w-0 flex-1 truncate text-[calc(11px*var(--ui-font-scale))] leading-tight">{node.name}</span>{nestedChanges ? <span className="agent-tree-git-count inline-grid h-5 min-w-5 shrink-0 place-items-center px-1 font-mono text-[calc(8px*var(--ui-font-scale))] font-semibold text-whx-faint" title={`${nestedChanges} alteração${nestedChanges === 1 ? '' : 'ões'} dentro desta pasta`}>{nestedChanges}</span> : null}{fileGit ? <GitChangeBadge file={fileGit}/> : null}
    </button>
    {open && node.children.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} expanded={expanded} focusedPath={focusedPath} gitByPath={gitByPath} gitDirectoryCounts={gitDirectoryCounts} onToggle={onToggle} onOpen={onOpen} onFocus={onFocus} onContextMenu={onContextMenu}/>)}</div>
  return <button type="button" className={`${rowClass} ${fileGit ? `git-changed git-${fileGit.status}` : ''}`} data-workspace-path={node.path} data-selected={selected} style={{ paddingLeft: 23 + depth * 13 }} onClick={() => { onFocus(node.path); onOpen(node.path) }} onContextMenu={(event) => onContextMenu(event, node)} title={`Abrir ${node.path}`} aria-label={`Abrir ${node.path}`}><FileGlyph path={node.path} size={15}/><span className="agent-tree-name min-w-0 flex-1 truncate text-[calc(11px*var(--ui-font-scale))] leading-tight">{node.name}</span>{fileGit ? <GitChangeBadge file={fileGit}/> : null}</button>
}

function GitChangeBadge({ file }: { file: GitWorkingFile }) {
  const code = file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'unmerged' ? '!' : 'M'
  const label = file.status === 'added' ? 'Adicionado' : file.status === 'deleted' ? 'Removido' : file.status === 'unmerged' ? 'Conflito' : 'Modificado'
  const statusTone: Record<GitWorkingFile['status'], string> = {
    modified: 'text-whx-soft',
    added: 'text-whx-success',
    deleted: 'text-whx-danger',
    unmerged: 'text-whx-warning',
  }
  return <span className={`agent-tree-git-status inline-flex shrink-0 items-center gap-1 px-1 py-[3px] font-mono text-[calc(9px*var(--ui-font-scale))] font-semibold leading-none ${statusTone[file.status]}`} title={`${label} no Git · +${file.additions || 0} −${file.deletions || 0}`}><b>{code}</b>{file.additions ? <i className="not-italic text-whx-success">+{file.additions}</i> : null}{file.deletions ? <i className="not-italic text-whx-danger">−{file.deletions}</i> : null}</span>
}
