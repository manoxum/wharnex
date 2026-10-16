import { useEffect, useMemo, useState } from 'react'
import { splitPatchByFile } from '../../../lib/execution/recovery/changeSummary'
import type { ChatChangeFile } from '../../../types'
import { ChangeDiffEditor } from '../../editor/canvas/ChangeDiffEditor'
import { EmptyState } from '../../presentation/workbench'
import { DiffReviewFrame } from './presentation/DiffReviewFrame'

export function GitDiffReview({ sessionId, diff, files: providedFiles, emptyText, fragmentOnly = false }: { sessionId: string; diff?: string; files?: ChatChangeFile[]; emptyText: string; fragmentOnly?: boolean }) {
  const parsedFiles = useMemo(() => splitPatchByFile(diff || ''), [diff])
  const files = providedFiles ?? parsedFiles
  const [selectedPath, setSelectedPath] = useState('')

  useEffect(() => {
    if (!files.length) setSelectedPath('')
    else if (!files.some((file) => file.path === selectedPath)) setSelectedPath(files[0].path)
  }, [files, selectedPath])

  const selected = files.find((file) => file.path === selectedPath) || files[0]
  if (!selected) return <EmptyState icon="git" title="Sem diferenças para apresentar" description={emptyText}/>

  return <DiffReviewFrame items={files.map((file) => ({ ...file, id: file.path }))} selected={{ ...selected, id: selected.path }} onSelect={setSelectedPath}>
    <ChangeDiffEditor sessionId={sessionId} file={selected} fragmentOnly={fragmentOnly} afterLabel="Versão em revisão"/>
  </DiffReviewFrame>
}
