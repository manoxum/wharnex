import { useEffect, useState } from 'react'
import { loadUIPreferences, subscribeUIPreferences } from '../../../lib/workspace/preferences/uiPreferences'
import { Icon } from '../../presentation/chrome/Icon'

export function ErrorToast({ open, message, shell = false, onDismiss, onShowInChat }: {
  open: boolean
  message?: string
  shell?: boolean
  onDismiss: () => void
  onShowInChat?: () => void
}) {
  const [enabled, setEnabled] = useState(() => loadUIPreferences().errorPopups)

  useEffect(() => subscribeUIPreferences((preferences) => setEnabled(preferences.errorPopups)), [])

  if (!open || !enabled) return null
  return <aside className={`error-toast ${shell ? 'shell-toast' : ''}`} role="status" aria-live="polite">
    <span className="error-toast-icon"><Icon name="close" size={13}/></span>
    <div className="error-toast-copy"><strong>Ocorreu um erro</strong><span>{message || (onShowInChat ? 'Os detalhes foram adicionados ao chat.' : 'A operação não foi concluída.')}</span></div>
    {onShowInChat && <button type="button" className="error-toast-link" onClick={onShowInChat}>Ver erro no chat</button>}
    <button type="button" className="error-toast-close" onClick={onDismiss} aria-label="Fechar aviso de erro"><Icon name="close" size={12}/></button>
  </aside>
}
