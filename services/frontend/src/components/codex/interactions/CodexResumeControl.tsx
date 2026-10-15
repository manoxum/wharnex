import { useState } from 'react'
import type { CodexThread } from '../../../lib/codex'
import { canResumeNative } from '../../../lib/codex/native'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { Icon } from '../../presentation/chrome/Icon'

export function CodexResumeControl({ thread, accountLabel }: { thread: CodexThread; accountLabel?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  if (!canResumeNative(thread)) return null
  const title = thread.pauseReason === 'context' ? 'Continuar Codex · limite de contexto; trocar de conta não aumenta esse limite'
    : thread.pauseReason === 'quota' ? 'Continuar Codex · escolha outra conta ou aguarde a renovação da quota'
    : `Continuar Codex${accountLabel ? ` · ${accountLabel}` : ''}`
  async function resume() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const action = desktopBridge()?.codex?.resumeNative
      if (!action) throw new Error('Atualize o Desktop para continuar o pedido.')
      await action(thread.projectPath, thread.chatId, thread.requestId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível continuar o pedido.'); setBusy(false)
    }
  }
  return <div aria-label="Continuação manual Codex" className="inline-flex min-w-0 items-center gap-2">
    <button type="button" aria-label="Continuar manualmente" aria-busy={busy} title={busy ? 'A retomar o Codex…' : title} disabled={busy} className="!inline-flex !size-7 !min-h-7 !shrink-0 items-center justify-center !rounded-md !border !border-solid !border-whx-accent/40 !bg-whx-accent-soft !p-0 !text-whx-accent ![box-shadow:none] hover:!border-whx-accent focus-visible:!outline-whx-accent disabled:!opacity-40 [&>svg]:shrink-0" onClick={() => void resume()}><Icon name={busy ? 'refresh' : 'play'} size={14}/></button>
    {error && <span role="alert" className="max-w-80 text-[calc(10px*var(--ui-font-scale))] leading-5 text-whx-warning">{error}</span>}
  </div>
}
