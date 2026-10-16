import type { GitWorkingFile } from '../../../../types'
import type { EditorRunOption } from '../../../../lib/editor/runtime/editorExecution'
import { editorDisplayLanguage } from '../../../../lib/editor/runtime/editorLanguage'
import { ControlPopover } from '../../../presentation/workbench'
import { Icon } from '../../../presentation/chrome/Icon'
import { GitFileState } from '../EditorGitState'
import { FileGlyph } from '../FileGlyph'

const actionClass = 'grid size-7 shrink-0 cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent p-0 text-whx-faint transition-colors hover:bg-whx-hover hover:text-whx-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whx-accent disabled:pointer-events-none disabled:opacity-40'

export function EditorContextBar({ path, projectPath, gitFile, gitDiffDisabled, gitDiffLoading, directRunOption, recentRunOptions, showPreviewToggle, previewing, onLocate, onShowGitDiff, onRun, onTogglePreview }: {
  path: string
  projectPath: string
  gitFile?: GitWorkingFile
  gitDiffDisabled: boolean
  gitDiffLoading: boolean
  directRunOption?: EditorRunOption
  recentRunOptions: EditorRunOption[]
  showPreviewToggle: boolean
  previewing: boolean
  onLocate?: () => void
  onShowGitDiff: () => void
  onRun: (id: string) => void
  onTogglePreview: () => void
}) {
  const projectName = projectPath.split(/[\\/]/).filter(Boolean).at(-1) || projectPath
  const parts = path.split('/').filter(Boolean)
  const fileName = parts.at(-1) || path
  const folders = parts.slice(0, -1)
  const visibleFolders = folders.slice(-2)
  const hiddenFolders = folders.length - visibleFolders.length
  const fullLocation = `${projectPath.replace(/[\\/]$/, '')}/${path}`
  return <div className="editor-contextbar flex h-[34px] min-w-0 shrink-0 items-center justify-between gap-2 border-b border-whx-border-soft bg-whx-surface px-3 text-whx-faint">
    <nav aria-label="Localização do ficheiro" title={fullLocation} className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap font-mono text-[calc(10px*var(--ui-font-scale))]">
      <span className="inline-flex min-w-0 shrink items-center gap-1.5 text-whx-faint" title={projectPath}><Icon name="workspace" size={14}/><span className="max-w-24 truncate">{projectName}</span></span>
      {hiddenFolders > 0 && <span className="inline-flex shrink-0 items-center gap-1 text-whx-faint"><Icon name="chevron" size={11}/>…</span>}
      {visibleFolders.map((folder, index) => <span key={`${folder}-${index}`} className="inline-flex min-w-0 shrink items-center gap-1 text-whx-soft"><Icon name="chevron" size={11}/><span className="max-w-[clamp(2.5rem,8vw,8rem)] truncate">{folder}</span></span>)}
      <span className="inline-flex min-w-0 shrink items-center gap-1.5"><Icon name="chevron" size={11}/><FileGlyph path={path} size={15}/><strong className="max-w-[clamp(5rem,18vw,18rem)] truncate font-semibold text-whx-text">{fileName}</strong></span>
    </nav>
    <div className="flex min-w-0 shrink-0 items-center gap-1" role="toolbar" aria-label="Ações do ficheiro">
      <span className="grid size-7 shrink-0 place-items-center text-whx-faint" role="img" aria-label={`Linguagem: ${editorDisplayLanguage(path)}`} title={editorDisplayLanguage(path)}><Icon name="code" size={14}/></span>
      {gitFile && <GitFileState file={gitFile} compact className="editor-git-context-state mx-1"/>}
      <span className="mx-0.5 h-4 w-px bg-whx-border-soft" aria-hidden="true"/>
      {onLocate && <button type="button" className={actionClass} title="Localizar este ficheiro no Explorer" aria-label="Localizar no Explorer" onClick={onLocate}><Icon name="locate" size={15}/></button>}
      <button type="button" className={actionClass} title={gitDiffLoading ? 'A comparar com o Git…' : gitFile ? 'Comparar o ficheiro guardado com o Git' : 'Sem alterações Git guardadas neste ficheiro'} aria-label="Git diff" disabled={gitDiffDisabled} onClick={onShowGitDiff}><Icon name="git" size={15}/></button>
      {directRunOption && <button type="button" className={`${actionClass} text-whx-accent`} title={directRunOption.label} aria-label={`Executar ${directRunOption.label}`} onClick={() => onRun(directRunOption.id)}><Icon name="play" size={14}/></button>}
      {recentRunOptions.length > 0 && <ControlPopover label="Execuções recentes" icon="history" alignment="end">
        {(close) => <div className="grid min-w-0 gap-0.5">
          {recentRunOptions.map((option) => <button type="button" key={`${option.cwd}:${option.command}`} className="grid min-h-10 w-full min-w-0 cursor-pointer justify-items-start gap-0.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left transition-colors hover:bg-whx-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whx-accent" onClick={() => { onRun(option.id); close() }}>
            <span className="text-[calc(12px*var(--ui-font-scale))] text-whx-text">{option.label}</span>
            <code title={option.command} className="max-w-full truncate font-mono text-[calc(11px*var(--ui-font-scale))] text-whx-faint">{option.command}</code>
          </button>)}
        </div>}
      </ControlPopover>}
      {showPreviewToggle && <button type="button" className={actionClass} title={previewing ? 'Editar ficheiro' : 'Pré-visualizar ficheiro'} aria-label={previewing ? 'Editar ficheiro' : 'Pré-visualizar ficheiro'} onClick={onTogglePreview}><Icon name={previewing ? 'code' : 'external'} size={15}/></button>}
    </div>
  </div>
}
