import { useEffect, useState } from 'react'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { Icon } from '../../presentation/chrome/Icon'

// The Worker stays at its automation viewport in a user-opened native window.
// The local panel only controls that window; it never reads the remote page.
export function WorkerFollowViewer({ agentId, onStop }: { agentId: string; onStop: () => void; onError?: (message?: string) => void }) {
  const bridge = desktopBridge()?.agents
  const [status, setStatus] = useState<'opening' | 'open' | 'error'>('opening')

  useEffect(() => {
    if (!bridge) return
    let active = true
    let opened = false
    setStatus('opening')
    const opening = bridge.openMonitor(agentId)
    const off = bridge.onState((runtime) => {
      if (active && opened && runtime.agents.find((agent) => agent.id === agentId)?.monitor_open === false) onStop()
    })
    void opening.then(() => { if (active) { opened = true; setStatus('open') } }).catch(() => { if (active) setStatus('error') })
    return () => {
      active = false
      off()
      void opening.finally(() => bridge.closeMonitor(agentId)).catch(() => undefined)
    }
  }, [bridge, agentId])

  if (!bridge) return null

  const reopen = () => {
    setStatus('opening')
    void bridge.openMonitor(agentId).then(() => setStatus('open')).catch(() => setStatus('error'))
  }
  const stop = () => { void bridge.closeMonitor(agentId).finally(onStop) }

  return <section className="mx-auto mb-[22px] w-full max-w-[1100px] overflow-hidden rounded-[14px] border border-whx-border-soft bg-whx-surface shadow-[0_8px_24px_color-mix(in_srgb,var(--theme-shadow)_26%,transparent)]">
    <header className="flex min-h-11 items-center justify-between gap-3 border-b border-whx-border-soft bg-[color-mix(in_srgb,var(--theme-accent)_8%,var(--theme-surface))] px-4 py-[9px]">
      <div className="flex min-w-0 items-center gap-2 text-whx-accent"><Icon name="monitor" size={13}/><div><strong className="block text-[calc(8px*var(--ui-font-scale))] text-whx-text">Seguindo {agentId.startsWith('ephemeral-') || agentId.startsWith('translator-') ? 'Worker efémero' : agentId.replace('worker-', 'Worker ')}</strong><small className="text-[calc(6.8px*var(--ui-font-scale))] text-whx-faint">Janela da instância em tamanho real · 1280 × 900</small></div></div>
      <div className="flex shrink-0 gap-2"><button type="button" className="min-h-7 cursor-pointer rounded-[7px] border border-whx-border bg-whx-elevated px-[10px] text-[calc(7px*var(--ui-font-scale))] font-semibold text-whx-text hover:bg-whx-hover" onClick={reopen}>Reabrir janela</button><button type="button" className="min-h-7 cursor-pointer rounded-[7px] border border-whx-border bg-whx-elevated px-[10px] text-[calc(7px*var(--ui-font-scale))] font-semibold text-whx-text hover:bg-whx-hover" onClick={stop}>Parar de seguir</button></div>
    </header>
    <p role="status" className="px-4 py-3 text-sm text-whx-faint">{status === 'opening' ? 'A abrir a janela do Worker…' : status === 'error' ? 'Não foi possível abrir a janela do Worker. Tente novamente.' : 'Janela do Worker aberta. A automação continua na mesma instância.'}</p>
  </section>
}
