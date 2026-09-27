import { useEffect, useRef, useState } from 'react'
import { desktopBridge } from '../lib/desktop'
import { Icon } from './Icon'

const FRAME_INTERVAL_MS = 3000

// Frames are displayed only in this user-opened local viewer. Capturing the
// hidden renderer does not navigate, resize, focus, or claim its Worker slot.
export function WorkerFollowViewer({ agentId, onStop }: { agentId: string; onStop: () => void; onError?: (message?: string) => void }) {
  const bridge = desktopBridge()?.agents
  const [frame, setFrame] = useState<{ agentId: string; dataUrl: string; capturedAt: string }>()
  const [captureError, setCaptureError] = useState(false)
  const latestAgent = useRef(agentId)
  latestAgent.current = agentId

  useEffect(() => {
    if (!bridge) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setFrame(undefined)
    setCaptureError(false)
    const capture = async () => {
      try {
        const next = await bridge.snapshot(agentId)
        if (active && latestAgent.current === agentId) {
          setFrame(next)
          setCaptureError(false)
        }
      } catch {
        if (active && latestAgent.current === agentId) setCaptureError(true)
      } finally {
        if (active) timer = setTimeout(capture, FRAME_INTERVAL_MS)
      }
    }
    void capture()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [bridge, agentId])

  if (!bridge) return null

  return <section className="mx-auto mb-[22px] w-full max-w-[1100px] overflow-hidden rounded-[14px] border border-whx-border-soft bg-whx-surface shadow-[0_8px_24px_color-mix(in_srgb,var(--theme-shadow)_26%,transparent)]">
    <header className="flex min-h-11 items-center justify-between gap-3 border-b border-whx-border-soft bg-[color-mix(in_srgb,var(--theme-accent)_8%,var(--theme-surface))] px-4 py-[9px]">
      <div className="flex min-w-0 items-center gap-2 text-whx-accent"><Icon name="monitor" size={13}/><div><strong className="block text-[calc(8px*var(--ui-font-scale))] text-whx-text">Seguindo {agentId.replace('worker-', 'Worker ')}</strong><small className="text-[calc(6.8px*var(--ui-font-scale))] text-whx-faint">Imagem atualizada a cada 3 s · automação em curso</small></div></div>
      <button type="button" className="min-h-7 shrink-0 cursor-pointer rounded-[7px] border border-whx-border bg-whx-elevated px-[10px] text-[calc(7px*var(--ui-font-scale))] font-semibold text-whx-text hover:bg-whx-hover" onClick={onStop}>Parar de seguir</button>
    </header>
    <div className="relative flex h-[460px] items-center justify-center overflow-auto bg-whx-surface" aria-label={`Visualização em tempo real de ${agentId}`}>
      {frame?.agentId === agentId ? <img className="max-h-full max-w-full object-contain" src={frame.dataUrl} alt={`Navegador de ${agentId}, capturado às ${new Date(frame.capturedAt).toLocaleTimeString()}`}/> : <span className="text-sm text-whx-faint">A obter imagem do Worker…</span>}
      {captureError && <span role="status" className="absolute rounded bg-whx-elevated px-2 py-1 text-sm text-whx-warning">Não foi possível atualizar a imagem. A tentar novamente.</span>}
    </div>
  </section>
}
