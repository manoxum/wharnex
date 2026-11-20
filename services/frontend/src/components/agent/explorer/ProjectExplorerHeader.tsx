import { IconButton, PanelHeader } from '../../presentation/workbench'
import { translate as uiText } from '../../../lib/workspace/localization'

export function ProjectExplorerHeader({ projectPath, expanded, loading, onCreateFile, onCreateFolder, onCollapse, onRefresh, onClose }: {
  projectPath: string; expanded: boolean; loading: boolean
  onCreateFile: () => void; onCreateFolder: () => void; onCollapse: () => void; onRefresh: () => void; onClose: () => void
}) {
  const projectName = projectPath.split(/[\\/]/).filter(Boolean).at(-1) || projectPath
  return <div className="shrink-0 border-b border-whx-border-soft bg-whx-surface" title={projectPath}>
    <PanelHeader title={projectName} icon="folder" actions={<IconButton label={uiText('Fechar explorador')} icon="close" onClick={onClose}/>}/>
    <div className="flex h-8 items-center gap-1 border-b border-whx-border-soft bg-whx-side px-2" role="toolbar" aria-label={uiText('Ações do projeto')}>
      <IconButton label={uiText('Novo ficheiro')} icon="new-file" onClick={onCreateFile}/>
      <IconButton label={uiText('Nova pasta')} icon="new-folder" onClick={onCreateFolder}/>
      <span className="ml-1 min-w-0 flex-1 truncate text-[calc(10px*var(--ui-font-scale))] text-whx-faint" title={projectPath}>{projectPath}</span>
      <div className="flex gap-0.5"><IconButton label={uiText('Recolher todas as pastas')} icon="collapse" disabled={!expanded} onClick={onCollapse}/><IconButton label={uiText('Atualizar ficheiros')} icon="refresh" disabled={loading} onClick={onRefresh}/></div>
    </div>
  </div>
}
