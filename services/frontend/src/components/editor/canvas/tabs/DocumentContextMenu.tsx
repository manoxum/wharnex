import { translate as uiText, formatMessage } from '../../../../lib/workspace/localization'
import { ContextMenu, type ContextAction } from '../../../presentation/menus'
import type { CloseScope } from './useDocumentActions'
export function DocumentContextMenu({ path, x, y, projectPath, pinned, canClose, canBatch, onClose, onCloseScope, onTogglePin, onReopen, onLocate, onError }: {
  path: string; x: number; y: number; projectPath: string; pinned: boolean; canClose: boolean; canBatch: boolean
  onClose: () => void; onCloseScope: (path: string, scope: CloseScope) => void
  onTogglePin?: (path: string) => void; onReopen?: () => void; onLocate?: (path: string) => void; onError?: (message: string) => void
}) {
  const close = (scope: CloseScope) => () => onCloseScope(path, scope)
  const copy = (value: string) => () => { void navigator.clipboard.writeText(value).catch(() => onError?.(uiText('Não foi possível copiar o caminho. Verifique a permissão da área de transferência.'))) }
  const actions: ContextAction[] = [
    { id: 'close', label: uiText("Fechar atual"), icon: 'close', disabled: !canClose, run: close('current') },
    { id: 'others', label: uiText("Fechar outros"), disabled: !canClose || !canBatch, run: close('others') },
    { id: 'all', label: uiText("Fechar todos"), disabled: !canClose || !canBatch, run: close('all') },
    { id: 'right', label: uiText("Fechar separadores à direita"), disabled: !canClose || !canBatch, run: close('right') },
    { id: 'pin', label: uiText(pinned ? "Desafixar separador" : "Fixar separador"), icon: 'pin', separator: true, disabled: !onTogglePin, run: () => onTogglePin?.(path) },
    { id: 'copy', label: uiText("Copiar caminho do ficheiro"), icon: 'copy', separator: true, run: copy(`${projectPath.replace(/\/$/, '')}/${path}`) },
    { id: 'relative', label: uiText("Copiar caminho relativo"), run: copy(path) },
    { id: 'reveal', label: uiText("Revelar no explorador de ficheiros"), icon: 'folder', disabled: !onLocate, run: () => onLocate?.(path) },
    { id: 'reopen', label: uiText("Reabrir último separador fechado"), icon: 'history', separator: true, disabled: !onReopen, run: () => onReopen?.() },
  ]
  return <ContextMenu x={x} y={y} label={formatMessage('Ações de {path}', { path })} actions={actions} onClose={onClose}/>
}
