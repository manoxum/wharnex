import { useState } from 'react'
import type { CodexThread } from '../../../lib/codex'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { Icon } from '../../presentation/chrome/Icon'
import { codexButton } from '../presentation'

export function CodexCancelControl({ thread }: { thread: CodexThread }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function cancel() {
    setBusy(true); setError('')
    try {
      const operation = desktopBridge()?.codex?.cancelNativeRequest
      if (!operation) throw new Error('Atualize o Desktop para cancelar o pedido.')
      await operation(thread.projectPath, thread.chatId, thread.requestId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível cancelar o pedido Codex.') }
    finally { setBusy(false) }
  }
  if (!thread.native || !['submitting', 'running', 'waiting', 'attention'].includes(thread.status)) return null
  return <div className="my-3">
    {error && <p role="alert" className="text-[calc(11px*var(--ui-font-scale))] leading-6 text-whx-warning">{error}</p>}
    <button type="button" disabled={busy} className={codexButton} onClick={() => void cancel()}><Icon name="stop" size={13}/>{busy ? 'A cancelar…' : 'Cancelar pedido Codex'}</button>
  </div>
}
