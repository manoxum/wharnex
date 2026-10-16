import { IconButton, PanelHeader } from '../../../presentation/workbench'
export function ArtifactLibraryHeader({ uploadable, uploading, onUpload, onRefresh, onClose }: { uploadable: boolean; uploading: boolean; onUpload: () => void; onRefresh: () => void; onClose?: () => void }) {
  return <PanelHeader title="Biblioteca de ficheiros" description="Todos os artefactos guardados" icon="package" actions={<>{uploadable && <IconButton label="Carregar ficheiros" icon="plus" disabled={uploading} onClick={onUpload}/>}<IconButton label="Atualizar biblioteca" icon="refresh" onClick={onRefresh}/>{onClose && <IconButton label="Fechar biblioteca" icon="close" onClick={onClose}/>}</>}/>
}
