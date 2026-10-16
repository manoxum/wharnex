import { useRef, useState } from 'react'
import type { GitFileDiff, GitOverview } from '../../../../types'
import { api } from '../../../../lib/transport/http/api'
import { InternalWindow } from '../../../workspace/window/InternalWindow'
import { ChangeDiffEditor } from '../../../editor/canvas/ChangeDiffEditor'
import { ContentSkeleton } from '../../../presentation/chrome/Skeleton'
import { WindowPanelHeader } from '../../../workspace/window/chrome'
import { DiffReviewFrame } from '../presentation/DiffReviewFrame'

type WorktreeDiffTarget = { repository: string; repositoryLabel: string; file: GitOverview['working']['files'][number] }
export type WorktreeDiffState = { initialFile: GitFileDiff; initialTarget: WorktreeDiffTarget; targets: WorktreeDiffTarget[] }

export function WorktreeDiffModal({ sessionId, state, onClose }: { sessionId: string; state: WorktreeDiffState; onClose: () => void }) {
  const [selectedTarget, setSelectedTarget] = useState(state.initialTarget)
  const [selectedFile, setSelectedFile] = useState<GitFileDiff | null>(state.initialFile)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestSequence = useRef(0)
  const showOrigin = new Set(state.targets.map((target) => target.repository)).size > 1
  const selectedStats = selectedTarget.file

  async function selectTarget(target: WorktreeDiffTarget) {
    if (target.repository === selectedTarget.repository && target.file.path === selectedTarget.file.path) return
    if (target.file.kind === 'submodule' || target.file.kind === 'embedded_repository') return
    const sequence = ++requestSequence.current
    setSelectedTarget(target)
    setSelectedFile(null)
    setLoading(true)
    setError('')
    try {
      const next = await api.gitFileDiff(sessionId, target.file.path, target.repository)
      if (sequence === requestSequence.current) setSelectedFile(next)
    } catch (cause) {
      if (sequence === requestSequence.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }

  const key = (target: WorktreeDiffTarget) => `${target.repository}:${target.file.kind}:${target.file.path}`
  const items = state.targets.map((target) => ({ id: key(target), path: target.file.path, label: showOrigin ? `${target.file.path} · ${target.repositoryLabel}` : target.file.path,
    actionLabel: `Abrir ${target.file.path} no diff do worktree`, additions: target.file.additions || 0, deletions: target.file.deletions || 0,
    disabled: target.file.kind === 'submodule' || target.file.kind === 'embedded_repository' || loading && key(target) === key(selectedTarget) }))
  const selected = items.find((item) => item.id === key(selectedTarget)) || items[0]
  return <InternalWindow title={`Diff de ${selectedTarget.file.path}`} onClose={onClose} layerClassName="git-diff-backdrop" maximizable controlsInHeader closeLabel="Fechar diff">
    <div className="flex h-[min(86vh,900px)] w-[min(96vw,1680px)] min-w-0 flex-col overflow-hidden rounded-xl border border-whx-border bg-whx-bg" role="dialog" aria-modal="false" aria-label={`Diff de ${selectedTarget.file.path}`}>
      <WindowPanelHeader title={selectedTarget.file.path} description="Alterações no worktree · revisão de conteúdo" icon="git" onClose={onClose} closeLabel="Fechar diff"/>
      <DiffReviewFrame items={items} selected={selected} onSelect={(id) => { const target = state.targets.find((candidate) => key(candidate) === id); if (target) void selectTarget(target) }}>
        {loading && <ContentSkeleton label={`A carregar diff de ${selectedTarget.file.path}`} rows={5}/>}
        {!loading && error && <p className="!m-0 p-4 !text-whx-label !text-whx-danger" role="alert">{error}</p>}
        {!loading && !error && selectedFile && <ChangeDiffEditor sessionId={sessionId} file={{ path: selectedFile.path, diff: selectedFile.diff, additions: selectedStats.additions || 0, deletions: selectedStats.deletions || 0 }} afterLabel="Versão de trabalho"/>}
      </DiffReviewFrame>
      {selectedFile?.truncated && <p className="!m-0 border-t border-whx-border-soft px-4 py-2 !text-whx-caption !text-whx-warning">O diff foi truncado apenas para apresentação.</p>}
    </div>
  </InternalWindow>
}
