import { IconButton } from '../../../presentation/workbench'

export function CommandLauncher({ onOpen }: { onOpen?: () => void }) {
  return <IconButton tone="quiet" icon="search" label="Pesquisar e executar comandos" title="Pesquisar e executar comandos · Ctrl/⌘ + Shift + P" onClick={() => onOpen ? onOpen() : window.dispatchEvent(new Event('wharnex:open-commands'))}/>
}
