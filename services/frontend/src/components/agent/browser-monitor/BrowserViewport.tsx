import { useEffect, useRef, useState } from 'react'
import { desktopBridge, elementBounds } from '../../../lib/desktop/bridge/desktop'

function EmptyBrowser({ title, message }: { title: string; message: string }) {
  return <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_45%,#1b3542_0%,#131f2d_46%,#101925_100%)] p-8 text-center" role="status"><div className="max-w-[310px]"><div className="mx-auto grid h-24 w-32 place-items-center rounded-2xl border border-white/10 bg-[#172839] shadow-[0_18px_45px_rgba(0,0,0,.25)]"><svg width="84" height="62" viewBox="0 0 84 62" fill="none" aria-hidden="true"><rect x="5" y="6" width="74" height="50" rx="7" stroke="#94a3b8" strokeWidth="1.5"/><path d="M5 17h74" stroke="#94a3b8" strokeWidth="1.5"/><circle cx="12" cy="12" r="1.5" fill="#22d3ee"/><circle cx="18" cy="12" r="1.5" fill="#64748b"/><circle cx="24" cy="12" r="1.5" fill="#64748b"/><path d="M31 36h7l4-8 5 16 4-8h7" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div><p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Centro de navegadores</p><h3 className="mt-2 text-[19px] font-semibold tracking-tight text-slate-100">{title}</h3><p className="mt-2 text-[13px] leading-6 text-slate-400">{message}</p></div></div>
}

// The real browser instance is composited over this area; project windows
// only show mirrors of it.
export function BrowserViewport({ agent }: { agent: DesktopAgentRuntimeAgent }) {
  const bridge = desktopBridge()?.agents
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = host.current
    if (!bridge || !element || !agent.browser.available) return
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
  }, [agent.id, agent.browser.available, bridge])

  return <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
    {agent.browser.available ? <div ref={host} className="h-full w-full" aria-label={`Navegador real de ${agent.label}`} /> : null}
    {!agent.browser.available || error ? <EmptyBrowser title={error ? 'Não foi possível apresentar' : 'Navegador ainda não criado'} message={error || 'A instância será criada quando receber um chat ou uma tarefa. Pode selecionar outro navegador na lista.'} /> : null}
  </div>
}
