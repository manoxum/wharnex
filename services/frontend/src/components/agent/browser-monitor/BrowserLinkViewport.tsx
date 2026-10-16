import { useEffect, useRef, useState } from 'react'
import { desktopBridge, elementBounds } from '../../../lib/desktop/bridge/desktop'
import type { BrowserMonitorChat } from '../../../lib/transport/http/browser-monitor/catalog'

// A selected historical chat gets a human-only native view, never an agent slot.
export function BrowserLinkViewport({ chat, suspended }: { chat: BrowserMonitorChat; suspended: boolean }) {
  const bridge = desktopBridge()?.agents
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = host.current
    if (!bridge || !element || suspended) return
    let alive = true
    let presented = false
    let pending = false
    let rerun = false
    const update = async () => {
      if (!alive || !host.current) return
      if (pending) { rerun = true; return }
      pending = true
      try {
        const bounds = elementBounds(host.current)
        if (presented) {
          const result = await bridge.resizeLinkInMonitor(bounds)
          if (!result.ok) presented = false
        }
        if (!presented) { await bridge.presentLinkInMonitor(chat.url, bounds); presented = true }
        if (alive) setError('')
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível apresentar este chat.')
      } finally { pending = false; if (rerun) { rerun = false; void update() } }
    }
    const observer = new ResizeObserver(() => { void update() })
    observer.observe(element)
    void update()
    return () => { alive = false; observer.disconnect(); void bridge.releaseLinkInMonitor(chat.url).catch(() => undefined) }
  }, [bridge, chat.url, suspended])

  useEffect(() => () => { void bridge?.closeLinkInMonitor(chat.url).catch(() => undefined) }, [bridge, chat.url])

  return <div className="relative min-h-0 flex-1 overflow-hidden bg-whx-bg">
    {!suspended ? <div ref={host} className="h-full w-full" aria-label={`Chat GPT: ${chat.title}`} /> : null}
    {error ? <div role="alert" className="absolute inset-0 grid place-items-center bg-whx-bg p-6 text-center text-sm text-whx-danger">{error}</div> : null}
  </div>
}
