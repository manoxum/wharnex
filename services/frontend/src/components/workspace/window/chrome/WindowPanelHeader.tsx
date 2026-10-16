import type { ReactNode } from 'react'
import type { IconName } from '../../../presentation/chrome/Icon'
import { IconButton, PanelHeader } from '../../../presentation/workbench'
import { useInternalWindowHeaderControls } from './headerControls'

export function WindowPanelHeader({ title, description, icon, children, onClose, closeLabel = 'Fechar janela' }: {
  title: string; description?: string; icon?: IconName; children?: ReactNode; onClose: () => void; closeLabel?: string
}) {
  const controls = useInternalWindowHeaderControls()
  return <PanelHeader title={title} description={description} icon={icon} actions={<>{children}{controls || <IconButton label={closeLabel} icon="close" onClick={onClose}/>}</>}/>
}
