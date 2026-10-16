import { IconButton, PanelHeader } from '../../presentation/workbench'

export function ProjectExplorerHeader({ projectPath, expanded, loading, onCreateFile, onCreateFolder, onCollapse, onRefresh, onClose }: {
  projectPath: string; expanded: boolean; loading: boolean
  onCreateFile: () => void; onCreateFolder: () => void; onCollapse: () => void; onRefresh: () => void; onClose: () => void
}) {
  const projectName = projectPath.split(/[\\/]/).filter(Boolean).at(-1) || projectPath
  return <div className="shrink-0 border-b border-whx-border-soft bg-whx-surface" title={projectPath}>
    <PanelHeader title={projectName} description="Explorador do projeto" icon="folder" actions={<IconButton label="Fechar explorador" icon="close" onClick={onClose}/>}/>
    <div className="flex items-center gap-1 px-3 py-1" role="toolbar" aria-label="Ações do projeto">
      <IconButton label="Novo ficheiro" icon="new-file" onClick={onCreateFile}/>
      <IconButton label="Nova pasta" icon="new-folder" onClick={onCreateFolder}/>
      <div className="ml-auto flex gap-1"><IconButton label="Recolher todas as pastas" icon="collapse" disabled={!expanded} onClick={onCollapse}/><IconButton label="Atualizar ficheiros" icon="refresh" disabled={loading} onClick={onRefresh}/></div>
    </div>
  </div>
}
