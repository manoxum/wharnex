import { useEffect, useMemo, useState } from 'react'
import { splitPatchByFile } from '../lib/changeSummary'
import { Icon } from './Icon'
import { ChangeDiffEditor } from './ChangeDiffEditor'

export function GitDiffReview({ sessionId, diff, emptyText }: { sessionId: string; diff?: string; emptyText: string }) {
  const files = useMemo(() => splitPatchByFile(diff || ''), [diff])
  const [selectedPath, setSelectedPath] = useState('')

  useEffect(() => {
    if (!files.length) setSelectedPath('')
    else if (!files.some((file) => file.path === selectedPath)) setSelectedPath(files[0].path)
  }, [files, selectedPath])

  const selected = files.find((file) => file.path === selectedPath) || files[0]
  if (!selected) return <p className="git-diff-empty">{emptyText}</p>
  const singleFile = files.length === 1

  return <div className={`git-diff-review ${singleFile ? 'single-file' : ''}`}>
    {!singleFile && <aside className="git-diff-review-files" aria-label="Ficheiros alterados">
      {files.map((file) => <button key={file.path} type="button" className={file.path === selected.path ? 'active' : ''} onClick={() => setSelectedPath(file.path)}>
        <Icon name="file" size={12}/>
        <span title={file.path}>{file.path}</span>
        <small><b>+{file.additions}</b><i>−{file.deletions}</i></small>
      </button>)}
    </aside>}
    <section className="git-diff-review-main">
      <header className="git-diff-review-file-heading"><strong>{selected.path}</strong><span><b>+{selected.additions}</b><i>−{selected.deletions}</i></span></header>
      <ChangeDiffEditor sessionId={sessionId} file={selected}/>
    </section>
  </div>
}
