import { useEffect, useState, type ReactNode } from 'react'
import { remoteApi } from '../lib/remoteApi'
import { Icon } from './Icon'

export function RemotePairingGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'paired' | 'waiting' | 'error'>('checking')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function resolvePairing() {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('pair') || ''
        if (code) {
          await remoteApi.claimPairing(code)
          params.delete('pair')
          const query = params.toString()
          window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
        }
        const status = await remoteApi.pairingStatus()
        if (!cancelled) setState(status.paired ? 'paired' : 'waiting')
      } catch (cause) {
        if (!cancelled) {
          setMessage(cause instanceof Error ? cause.message : String(cause))
          setState('error')
        }
      }
    }
    void resolvePairing()
    return () => { cancelled = true }
  }, [])

  if (state === 'paired') return <>{children}</>
  return <main className="grid min-h-dvh place-items-center bg-whx-bg px-5 py-10 text-whx-text">
    <section className="w-full max-w-[34rem] rounded-[22px] border border-whx-border bg-whx-surface p-7 shadow-[0_28px_90px_var(--theme-shadow)] sm:p-10" aria-live="polite">
      <div className="mb-8 flex items-center gap-3 text-whx-accent"><span className="grid size-10 place-items-center rounded-xl bg-whx-accent-soft"><Icon name="network" size={20}/></span><strong className="font-mono text-sm uppercase tracking-[0.18em]">Wharnex Remote</strong></div>
      <h1 className="m-0 max-w-[12ch] text-2xl font-semibold leading-[1.08]">Controle a sua instância com emparelhamento seguro.</h1>
      <p className="mt-4 text-base leading-6 text-whx-soft">Abra Infraestrutura remota no Wharnex Desktop e use o botão de emparelhamento do túnel. Este navegador só recebe acesso depois de consumir um código temporário e de uso único.</p>
      <div className="mt-8 rounded-xl border border-whx-border-soft bg-whx-elevated p-4">
        {state === 'checking' && <Status icon="refresh" title="A verificar sessão" detail="A confirmar se este navegador já está emparelhado." />}
        {state === 'waiting' && <Status icon="link" title="Aguardando emparelhamento" detail="Digitalize o QR no Desktop ou abra o link de emparelhamento gerado pelo túnel." />}
        {state === 'error' && <Status icon="alert" title="Não foi possível emparelhar" detail={message || 'O código expirou ou a instância deixou de estar disponível.'} danger />}
      </div>
      <p className="mb-0 mt-6 font-mono text-xs leading-5 text-whx-faint">Os navegadores de IA continuam a executar apenas no Desktop; esta aplicação envia comandos para a mesma API protegida da instância.</p>
    </section>
  </main>
}

function Status({ icon, title, detail, danger = false }: { icon: 'refresh' | 'link' | 'alert'; title: string; detail: string; danger?: boolean }) {
  return <div className="flex items-start gap-3"><span className={danger ? 'text-whx-danger' : 'text-whx-accent'}><Icon name={icon} size={18}/></span><div><strong className="block text-base">{title}</strong><span className="mt-1 block text-sm leading-5 text-whx-faint">{detail}</span></div></div>
}
