import { useEffect, useRef, useState } from 'react'
import { desktopBridge, elementBounds } from '../lib/desktop'
import { observeChatGPTOverlayBlockers } from '../lib/chatGPTOverlay'
import { Icon } from './Icon'

// Follows one Worker instance in place: any surface can embed this once it
// has resolved an agentId, without needing the Engine tab or a mode switch.
// It owns the same bridge calls Engine's own "Seguir (flow)" and the Agents
// drawer's "Interagir aqui" already use against the one shared native Worker
// pool, so only one of these should be mounted for a given agentId at a time.
export function WorkerFollowViewer({ agentId, onStop, onError }: { agentId: string; onStop: () => void; onError?: (message?: string) => void }) {
  const bridge = desktopBridge()?.agents
  const hostRef = useRef<HTMLDivElement>(null)
  const onStopRef = useRef(onStop)
  onStopRef.current = onStop
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const [overlayBlocked, setOverlayBlocked] = useState(false)

  useEffect(() => observeChatGPTOverlayBlockers(window, setOverlayBlocked), [])

  useEffect(() => {
    const host = hostRef.current
    if (!bridge || !host) return
    // A trusted overlay always wins: the WebContentsView paints above React
    // and must be closed — not merely resized behind it — while one is open.
    if (overlayBlocked) {
      void bridge.closeInteraction(agentId).catch(() => {})
      return
    }
    let active = true
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (active && hostRef.current) void bridge.setInteractionBounds(agentId, elementBounds(hostRef.current)).catch(() => {})
      })
    }
    void bridge.openInteraction(agentId, elementBounds(host)).catch((error) => {
      if (!active) return
      onErrorRef.current?.(error instanceof Error ? error.message : 'Não foi possível seguir o Worker')
      onStopRef.current()
    })
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      active = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
      void bridge.closeInteraction(agentId).catch(() => {})
    }
  }, [bridge, agentId, overlayBlocked])

  if (!bridge) return null

  return <div className="worker-follow-viewer">
    <div className="worker-follow-viewer-banner">
      <div><Icon name="monitor" size={13}/><div><strong>Seguindo {agentId.replace('worker-', 'Worker ')}</strong><small>Instância real do Worker em tempo real; o scheduler continua proprietário.</small></div></div>
      <button type="button" onClick={onStop}>Parar de seguir</button>
    </div>
    <div ref={hostRef} className="worker-follow-viewer-host" aria-label={`Navegador interativo de ${agentId}`}/>
  </div>
}
