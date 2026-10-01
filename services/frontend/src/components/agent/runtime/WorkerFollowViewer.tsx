import { useEffect, useRef, useState } from 'react'
import { desktopBridge, elementBounds } from '../../../lib/desktop/bridge/desktop'
import { Icon } from '../../presentation/chrome/Icon'
import { WorkerMirror } from '../../chatgpt/mirror/WorkerMirror'

export function WorkerFollowViewer({ agentId, onStop }: { agentId: string; onStop: () => void; onError?: (message?: string) => void }) {
  const bridge = desktopBridge()?.agents
  const hostRef = useRef<HTMLDivElement>(null)
  const onStopRef = useRef(onStop)
  const retryRef = useRef<() => void>(() => undefined)
  const [status, setStatus] = useState<'opening' | 'open' | 'error'>('opening')
  onStopRef.current = onStop

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    let active = true
    let opened = false
    let stopping = false
    let frame = 0
    const host = hostRef.current

    const closeInteraction = async () => {
      opened = false
      await bridge.closeInteraction(agentId).catch(() => undefined)
    }
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (active && opened && hostRef.current) void bridge.setInteractionBounds(agentId, elementBounds(hostRef.current)).catch(() => undefined)
      })
    }
    const openInteraction = async () => {
      setStatus('opening')
      try {
        await bridge.openInteraction(agentId, elementBounds(host))
        if (!active || stopping) {
          await closeInteraction()
          return
        }
        opened = true
        setStatus('open')
        sync()
      } catch {
        await closeInteraction()
        if (active && !stopping) setStatus('error')
      }
    }
    const stopFollowing = () => {
      if (stopping) return
      stopping = true
      void closeInteraction().finally(() => { if (active) onStopRef.current() })
    }

    retryRef.current = () => {
      if (stopping) return
      void closeInteraction().then(() => { if (active) return openInteraction() })
    }

    const off = bridge.onState((runtime) => {
      const worker = runtime.agents.find((agent) => agent.id === agentId)
      if (!worker || !worker.browser.available) stopFollowing()
    })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(sync)
    observer?.observe(host)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    void openInteraction()

    return () => {
      active = false
      retryRef.current = () => undefined
      cancelAnimationFrame(frame)
      observer?.disconnect()
      off()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
      void closeInteraction()
    }
  }, [bridge, agentId])

  if (!bridge) return null

  const workerLabel = agentId.startsWith('ephemeral-') || agentId.startsWith('translator-') ? 'Worker efémero' : agentId.replace('worker-', 'Worker ')
  const stop = () => {
    void bridge.closeInteraction(agentId).finally(() => onStopRef.current())
  }

  return <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-whx-surface">
    <header className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-whx-border-soft bg-[color-mix(in_srgb,var(--theme-accent)_8%,var(--theme-surface))] px-4 py-[9px]">
      <div className="flex min-w-0 items-center gap-2 text-whx-accent"><Icon name="monitor" size={13}/><div><strong className="block text-[calc(8px*var(--ui-font-scale))] text-whx-text">Seguindo {workerLabel}</strong><small className="text-[calc(6.8px*var(--ui-font-scale))] text-whx-faint">{status === 'opening' ? 'A incorporar a instância…' : status === 'error' ? 'Não foi possível incorporar a instância.' : 'Instância incorporada · interação ao vivo'}</small></div></div>
      <div className="flex shrink-0 gap-2">{status === 'error' && <button type="button" className="min-h-7 cursor-pointer rounded-[7px] border border-whx-border bg-whx-elevated px-[10px] text-[calc(7px*var(--ui-font-scale))] font-semibold text-whx-text hover:bg-whx-hover" onClick={() => retryRef.current()}>Tentar novamente</button>}<button type="button" className="min-h-7 cursor-pointer rounded-[7px] border border-whx-border bg-whx-elevated px-[10px] text-[calc(7px*var(--ui-font-scale))] font-semibold text-whx-text hover:bg-whx-hover" onClick={stop}>Voltar ao Supervisor</button></div>
    </header>
    <div ref={hostRef} className="relative min-h-[160px] flex-1 bg-whx-surface" aria-label={`Worker incorporado ${workerLabel}`}>
      {status === 'open' && <WorkerMirror agentId={agentId} label={`Espelho interativo de ${workerLabel}`} />}
      {status !== 'open' && <p role="status" className="absolute inset-0 grid place-items-center px-4 text-sm text-whx-faint">{status === 'opening' ? 'A abrir o Worker no Engine…' : 'Não foi possível abrir o Worker no Engine. Tente novamente ou volte ao Supervisor.'}</p>}
    </div>
  </section>
}
