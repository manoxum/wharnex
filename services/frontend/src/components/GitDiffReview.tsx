import { useEffect, useMemo, useState } from 'react'
import { splitPatchByFile } from '../lib/changeSummary'
import type { ChatChangeFile } from '../types'
import { Icon } from './Icon'
import { ChangeDiffEditor } from './ChangeDiffEditor'

export function GitDiffReview({ sessionId, diff, files: providedFiles, emptyText, fragmentOnly = false }: { sessionId: string; diff?: string; files?: ChatChangeFile[]; emptyText: string; fragmentOnly?: boolean }) {
  const parsedFiles = useMemo(() => splitPatchByFile(diff || ''), [diff])
  const files = providedFiles ?? parsedFiles
  const [selectedPath, setSelectedPath] = useState('')
  const [filesCollapsed, setFilesCollapsed] = useState(false)

  useEffect(() => {
    if (!files.length) setSelectedPath('')
    else if (!files.some((file) => file.path === selectedPath)) setSelectedPath(files[0].path)
  }, [files, selectedPath])

  const selected = files.find((file) => file.path === selectedPath) || files[0]
  if (!selected) return <p className="git-diff-empty">{emptyText}</p>
  const singleFile = files.length === 1

  return <div className={`git-diff-review ${singleFile ? 'single-file' : ''} ${filesCollapsed ? 'files-collapsed' : ''}`.trim()}>
    {!singleFile && <aside className="git-diff-review-files" aria-label="Ficheiros alterados">
      <div className="git-diff-review-files-toolbar">
        {!filesCollapsed && <strong>Ficheiros</strong>}
        <button type="button" className={filesCollapsed ? 'collapsed' : ''} aria-label={filesCollapsed ? 'Expandir lista de ficheiros' : 'Recolher lista de ficheiros'} aria-expanded={!filesCollapsed} onClick={() => setFilesCollapsed((value) => !value)} title={filesCollapsed ? 'Expandir lista de ficheiros' : 'Recolher lista de ficheiros'}><Icon name="chevron-right" size={11}/></button>
      </div>
      {!filesCollapsed && <div className="git-diff-review-file-list">
        {files.map((file) => <button key={file.path} type="button" className={file.path === selected.path ? 'active' : ''} aria-label={file.path} title={file.path} onClick={() => setSelectedPath(file.path)}>
          <Icon name="file" size={12}/>
          <span title={file.path}>{file.path}</span>
          <small><b>+{file.additions}</b><i>−{file.deletions}</i></small>
        </button>)}
      </div>}
    </aside>}
    <section className="git-diff-review-main">
      <header className="git-diff-review-file-heading"><strong>{selected.path}</strong><span><b>+{selected.additions}</b><i>−{selected.deletions}</i></span></header>
      <ChangeDiffEditor sessionId={sessionId} file={selected} fragmentOnly={fragmentOnly}/>
    </section>
  </div>
}
