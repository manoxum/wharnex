import { useState } from 'react'
import type { ChatChangeFile, ChatItem } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { ChangeDiffEditor } from '../../editor/canvas/ChangeDiffEditor'
import { formatMessageTime } from './noticePresentation'
import { isNormativeChangePath, prioritizedChangeFiles } from './presentation/changePriority'

const CHANGE_DIFF_PREVIEW_COUNT = 4

export function ChangeSummaryCard({ item, onInspect, onOpenFile, onRevert }: { item: ChatItem; onInspect: (file: ChatChangeFile) => void; onOpenFile?: (path: string) => void; onRevert?: (item: ChatItem) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false)
  const change = item.change!
  const hostCommands = change.hostCommands || []
  const additions = change.files.reduce((total, file) => total + file.additions, 0)
  const deletions = change.files.reduce((total, file) => total + file.deletions, 0)
  const prioritizedFiles = prioritizedChangeFiles(change.files)
  const visibleFiles = expanded ? prioritizedFiles : prioritizedFiles.slice(0, CHANGE_DIFF_PREVIEW_COUNT)
  const hiddenCount = Math.max(0, prioritizedFiles.length - visibleFiles.length)
  return <article className="change-summary-card">
    <header><div><span className="change-summary-icon"><Icon name="apply" size={14}/></span><div><strong>{change.reverted ? 'Alterações revertidas' : 'Alterações aplicadas'}</strong><span>{change.files.length} ficheiro(s) · {formatMessageTime(change.appliedAt)}</span></div></div><code>+{additions} <i>−{deletions}</i></code></header>
    {prioritizedFiles.length > 0 && <div className={`change-file-disclosure${hiddenCount ? ' collapsed' : ''}`}>
      <div className="change-file-list">{visibleFiles.map((file) => <div className={`change-file-row${isNormativeChangePath(file.path) ? ' normative' : ''}`} key={file.path}><button type="button" className="change-file-name" onClick={() => onOpenFile?.(file.path)} title="Abrir no Editor"><Icon name="file" size={12}/><span>{file.path}</span>{isNormativeChangePath(file.path) && <em>Normativo</em>}</button><button type="button" className="change-file-diff" onClick={() => onInspect(file)} title="Ver diff"><b>+{file.additions}</b><i>−{file.deletions}</i></button></div>)}</div>
      {prioritizedFiles.length > CHANGE_DIFF_PREVIEW_COUNT && <button type="button" className="change-file-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><span aria-hidden="true">{expanded ? '−' : '···'}</span>{expanded ? 'Mostrar menos diffs' : `Mostrar mais ${hiddenCount} diff${hiddenCount === 1 ? '' : 's'}`}</button>}
    </div>}
    {hostCommands.length > 0 && <div className="change-host-commands"><strong>Comandos no host</strong>{hostCommands.map((command, index) => <div className="change-host-command" key={`${command.argv.join(' ')}-${index}`}><code>{command.argv.join(' ')}</code><span>{command.cwd || '.'} · exit {command.exit_code} · {command.duration_ms} ms</span></div>)}</div>}
    <footer><span>Plano {change.planId}</span>{change.canRevert && <button type="button" className="text-button change-revert" onClick={() => void onRevert?.(item)}><Icon name="refresh" size={12}/> {change.reverted ? 'Repor alteração' : 'Reverter alteração'}</button>}</footer>
  </article>
}

export function DiffInspector({ sessionId, file, onOpenFile, onClose }: { sessionId: string; file: ChatChangeFile; onOpenFile?: (path: string) => void; onClose: () => void }) {
  return <InternalWindow title={`Diff de ${file.path}`} onClose={onClose} layerClassName="diff-inspector-backdrop"><section className="diff-inspector" role="dialog" aria-modal="false" aria-label={`Diff de ${file.path}`}><header><div><strong>{file.path}</strong><span>+{file.additions} −{file.deletions}</span></div><div><button type="button" className="text-button" onClick={() => { onOpenFile?.(file.path); onClose() }}><Icon name="file" size={12}/> Abrir no Editor</button><button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar diff"><Icon name="close" size={13}/></button></div></header><ChangeDiffEditor sessionId={sessionId} file={file}/></section></InternalWindow>
}
