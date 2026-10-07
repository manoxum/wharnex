import type { GitWorkingFile } from '../../../types'
export function GitFileState({ file, compact = false, className = '' }: { file: GitWorkingFile; compact?: boolean; className?: string }) {
  const code = file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'unmerged' ? '!' : 'M'
  const label = file.status === 'added' ? 'Adicionado' : file.status === 'deleted' ? 'Removido' : file.status === 'unmerged' ? 'Conflito' : 'Modificado'
  return <span className={`editor-git-file-state ${file.status} ${compact ? 'compact' : ''} ${className}`.trim()} title={`${label} no Git · +${file.additions || 0} −${file.deletions || 0}`}><b>{code}</b>{!compact && file.additions ? <i className="git-lines-added">+{file.additions}</i> : null}{!compact && file.deletions ? <i className="git-lines-deleted">−{file.deletions}</i> : null}</span>
}
