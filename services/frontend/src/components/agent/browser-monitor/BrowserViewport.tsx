import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '../../presentation/workbench'
import { desktopBridge, elementBounds } from '../../../lib/desktop/bridge/desktop'

function EmptyBrowser({ title, message }: { title: string; message: string }) {
  return <div className="absolute inset-0 grid place-items-center bg-whx-bg p-6"><EmptyState icon="monitor" title={title} description={message}/></div>
}

// The real browser instance is composited over this area; project windows
// only show mirrors of it.
export function BrowserViewport({ agent, suspended = false }: { agent: DesktopAgentRuntimeAgent; suspended?: boolean }) {
  const bridge = desktopBridge()?.agents
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = host.current
    if (!bridge || !element || !agent.browser.available || suspended) return
    let alive = true
    let presented = false
    let pending = false
    let rerun = false
    setError('')
    const update = async () => {
      if (!alive || !host.current) return
      if (pending) { rerun = true; return }
      pending = true
      try {
        const bounds = elementBounds(host.current)
        if (presented) {
          const result = await bridge.resizeInMonitor(agent.id, bounds)
          if (!result.ok) presented = false
        }
        if (!presented) { await bridge.presentInMonitor(agent.id, bounds); presented = true }
        if (alive) setError('')
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível apresentar o navegador')
      } finally { pending = false; if (rerun) { rerun = false; void update() } }
    }
    const observer = new ResizeObserver(() => { void update() })
    observer.observe(element)
    void update()
    return () => { alive = false; observer.disconnect(); void bridge.releaseFromMonitor(agent.id).catch(() => undefined) }
  }, [agent.id, agent.browser.available, bridge, suspended])

  return <div className="relative min-h-0 flex-1 overflow-hidden bg-whx-bg">
    {agent.browser.available && !suspended ? <div ref={host} className="h-full w-full" aria-label={`Navegador real de ${agent.label}`} /> : null}
    {!agent.browser.available || error ? <EmptyBrowser title={error ? 'Não foi possível apresentar' : 'Navegador ainda não criado'} message={error || 'A instância será criada quando receber um chat ou uma tarefa. Pode selecionar outro navegador na lista.'} /> : null}
  </div>
}
