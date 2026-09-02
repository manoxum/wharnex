import { useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import { api } from '../lib/api'
import { desktopBridge, elementBounds, formatBytes } from '../lib/desktop'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'

export function ChatGPTDesktopPane({ session, manualPrompt, busy, onSession, onManualPlan }: {
  session: Session
  manualPrompt: string
  busy: boolean
  onSession: (session: Session) => void
  onManualPlan: (json: string) => Promise<void>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<DesktopChatGPTState>({ url: 'https://chatgpt.com/', title: 'ChatGPT', loading: true, canGoBack: false, canGoForward: false })
  const [notice, setNotice] = useState('')
  const [manualJSON, setManualJSON] = useState('')
  const bridge = desktopBridge()

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (hostRef.current) void bridge.chatgpt.setBounds(elementBounds(hostRef.current))
      })
    }
    const observer = new ResizeObserver(sync)
    observer.observe(hostRef.current)
    window.addEventListener('resize', sync)
    void bridge.chatgpt.show(elementBounds(hostRef.current))
    void bridge.chatgpt.state().then(setState)
    const unsubscribe = bridge.chatgpt.onState(setState)
    const unsubscribeAuth = bridge.chatgpt.onExternalAuth(({ provider }) => {
      setNotice(`${provider} foi aberto no navegador do sistema para reutilizar a sessão existente. Por segurança, a sessão do Chrome não é importada para o Electron; conclua o login no navegador ou use um método de login compatível dentro do ChatGPT incorporado.`)
    })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', sync)
      unsubscribe()
      unsubscribeAuth()
      void bridge.chatgpt.hide()
    }
  }, [bridge])

  async function copyContext() {
    if (!bridge) return
    setNotice('A atualizar o contexto do projeto…')
    try {
      const refreshed = await api.refreshContext(session.id)
      onSession(refreshed)
      const result = await bridge.clipboard.copyContextZip({ sessionId: refreshed.id })
      setNotice(`Contexto ZIP copiado como ficheiro (${formatBytes(result.bytes)}). Clique no campo de mensagem do ChatGPT e prima Ctrl+V.`)
      await bridge.chatgpt.focus()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao copiar o contexto ZIP.')
    }
  }

  async function copyPrompt() {
    if (!manualPrompt) return
    if (bridge) await bridge.clipboard.writeText(manualPrompt)
    else await navigator.clipboard.writeText(manualPrompt)
    setNotice('Prompt copiado. Clique no campo do ChatGPT e prima Ctrl+V.')
    await bridge?.chatgpt.focus()
  }

  async function pastePlanFromClipboard() {
    try {
      const text = bridge ? await bridge.clipboard.readText() : await navigator.clipboard.readText()
      setManualJSON(text)
      setNotice('Resposta do clipboard colocada no campo JSON. Confirme e valide o plano.')
    } catch {
      setNotice('Não foi possível ler texto do clipboard. Cole o JSON manualmente.')
    }
  }

  return <div className="desktop-chatgpt-shell">
    <div className="desktop-chatgpt-toolbar">
      <div className="desktop-browser-controls">
        <button className="icon-button light" disabled={!state.canGoBack} title="Voltar" onClick={() => void bridge?.chatgpt.back()}><Icon name="arrow-left" size={15}/></button>
        <button className="icon-button light" disabled={!state.canGoForward} title="Avançar" onClick={() => void bridge?.chatgpt.forward()}><Icon name="arrow-right" size={15}/></button>
        <button className="icon-button light" title="Recarregar ChatGPT" onClick={() => void bridge?.chatgpt.reload()}><Icon name="refresh" size={15}/></button>
        <button className="icon-button light" title="Abrir ChatGPT no navegador do sistema" onClick={() => void bridge?.chatgpt.openExternal()}><Icon name="external" size={15}/></button>
        <button className="icon-button light" title="Colar clipboard no campo focado do ChatGPT" onClick={() => void bridge?.chatgpt.paste()}><Icon name="clipboard" size={15}/></button>
      </div>
      <div className="desktop-browser-address" title={state.url}><span className={state.loading ? 'browser-lamp loading' : 'browser-lamp'} /><strong>{state.title || 'ChatGPT'}</strong><span>{safeHost(state.url)}</span></div>
      <StatusPill tone="success">Sessão persistente</StatusPill>
    </div>

    <div className="desktop-chatgpt-actions">
      <div className="desktop-step"><span>1</span><button className="secondary-button" disabled={busy} onClick={() => void copyContext()}><Icon name="copy" size={15}/> Copiar contexto ZIP</button><small>Clique no composer e use Ctrl+V ou o botão Colar da barra.</small></div>
      <div className="desktop-step"><span>2</span><button className="secondary-button" disabled={!manualPrompt} onClick={() => void copyPrompt()}><Icon name="copy" size={15}/> Copiar prompt</button><small>Depois do ZIP, cole o prompt no composer.</small></div>
      <div className="desktop-step"><span>3</span><button className="secondary-button" onClick={() => void pastePlanFromClipboard()}><Icon name="clipboard" size={15}/> Colar resposta JSON</button><small>Copie o JSON no ChatGPT e importe-o aqui.</small></div>
    </div>
    {notice && <div className="desktop-chatgpt-notice">{notice}</div>}

    <div ref={hostRef} className="desktop-chatgpt-host" aria-label="ChatGPT incorporado"><div className="desktop-chatgpt-loading">A carregar ChatGPT…</div></div>

    <div className="desktop-plan-import">
      <label className="field-label" htmlFor="desktop-manual-json">Plano JSON devolvido pelo ChatGPT</label>
      <div className="desktop-plan-import-row">
        <textarea id="desktop-manual-json" className="json-input compact" spellCheck={false} value={manualJSON} onChange={(event) => setManualJSON(event.target.value)} placeholder={'{\n  "protocol": "harness.execution/v1",\n  ...\n}'} />
        <button className="primary-button" disabled={busy || !manualJSON.trim()} onClick={() => onManualPlan(manualJSON)}>Validar plano</button>
      </div>
    </div>
  </div>
}

function safeHost(value: string) {
  try { return new URL(value).host }
  catch { return 'chatgpt.com' }
}
