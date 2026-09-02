import { useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import { api } from '../lib/api'
import { chatgptConversationURL, desktopBridge, elementBounds, formatBytes } from '../lib/desktop'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'

const CHATGPT_HOME = 'https://chatgpt.com/'

export function ChatGPTDesktopPane({ session, manualPrompt, busy, chatId, chatTitle, chatgptUrl, onChatGPTURL, onSession, onManualPlan }: {
  session: Session
  manualPrompt: string
  busy: boolean
  chatId: string
  chatTitle: string
  chatgptUrl?: string
  onChatGPTURL: (url: string) => void
  onSession: (session: Session) => void
  onManualPlan: (json: string) => Promise<void>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const bindingReadyRef = useRef(false)
  const linkedURLRef = useRef(chatgptUrl)
  const onURLRef = useRef(onChatGPTURL)
  const [state, setState] = useState<DesktopChatGPTState>({ url: CHATGPT_HOME, title: 'ChatGPT', loading: true, canGoBack: false, canGoForward: false })
  const [notice, setNotice] = useState('')
  const [manualJSON, setManualJSON] = useState('')
  const bridge = desktopBridge()

  useEffect(() => { linkedURLRef.current = chatgptUrl; onURLRef.current = onChatGPTURL }, [chatgptUrl, onChatGPTURL])

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { if (hostRef.current) void bridge.chatgpt.setBounds(elementBounds(hostRef.current)) })
    }
    const observer = new ResizeObserver(sync)
    observer.observe(hostRef.current)
    window.addEventListener('resize', sync)
    void bridge.chatgpt.show(elementBounds(hostRef.current))
    void bridge.chatgpt.state().then(setState)
    const unsubscribe = bridge.chatgpt.onState((next) => {
      setState(next)
      const conversation = chatgptConversationURL(next.url)
      if (bindingReadyRef.current && !linkedURLRef.current && conversation) {
        linkedURLRef.current = conversation
        onURLRef.current(conversation)
        setNotice('Conversa ChatGPT vinculada automaticamente a este chat do Harness.')
      }
    })
    const unsubscribeAuth = bridge.chatgpt.onExternalAuth(({ provider }) => {
      setNotice(`${provider} foi aberto no navegador do sistema. A sessão remota do ChatGPT continua isolada no Wharness Desktop.`)
    })
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', sync)
      unsubscribe(); unsubscribeAuth(); void bridge.chatgpt.hide()
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge || !chatId) return
    setManualJSON('')
    let alive = true
    bindingReadyRef.current = false
    const target = chatgptUrl || CHATGPT_HOME
    setNotice(chatgptUrl ? `A recuperar a conversa ChatGPT vinculada a “${chatTitle}”…` : `Novo chat “${chatTitle}”: a primeira conversa criada no ChatGPT será vinculada automaticamente.`)
    void bridge.chatgpt.navigate(target).then((next) => {
      if (!alive) return
      setState(next)
      bindingReadyRef.current = true
      const conversation = chatgptConversationURL(next.url)
      if (!linkedURLRef.current && conversation) {
        linkedURLRef.current = conversation
        onURLRef.current(conversation)
      }
    }).catch((error) => {
      if (alive) setNotice(error instanceof Error ? error.message : 'Não foi possível abrir a conversa ChatGPT vinculada.')
    })
    return () => { alive = false; bindingReadyRef.current = false }
  }, [bridge, chatId, chatTitle, chatgptUrl])

  async function copyContext() {
    if (!bridge) return
    setNotice('A atualizar o contexto do projeto…')
    try {
      const refreshed = await api.refreshContext(session.id)
      onSession(refreshed)
      const result = await bridge.clipboard.copyContextZip({ sessionId: refreshed.id })
      setNotice(`Contexto ZIP copiado como ficheiro (${formatBytes(result.bytes)}). Clique no campo do ChatGPT e prima Ctrl+V.`)
      await bridge.chatgpt.focus()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Falha ao copiar o contexto ZIP.') }
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
      setManualJSON(text); setNotice('Resposta do clipboard colocada no campo JSON. Confirme e valide o plano.')
    } catch { setNotice('Não foi possível ler texto do clipboard. Cole o JSON manualmente.') }
  }

  function bindCurrentConversation() {
    const conversation = chatgptConversationURL(state.url)
    if (!conversation) { setNotice('Abra primeiro uma conversa concreta do ChatGPT para poder vinculá-la.'); return }
    linkedURLRef.current = conversation
    onChatGPTURL(conversation)
    setNotice('Esta conversa ChatGPT foi vinculada ao chat atual do Harness.')
  }

  const currentConversation = chatgptConversationURL(state.url)
  const mismatch = Boolean(chatgptUrl && currentConversation && currentConversation !== chatgptConversationURL(chatgptUrl) || chatgptUrl)

  return <div className="desktop-chatgpt-shell">
    <div className="desktop-chatgpt-toolbar">
      <div className="desktop-browser-controls">
        <button className="icon-button light" disabled={!state.canGoBack} title="Voltar" onClick={() => void bridge?.chatgpt.back()}><Icon name="arrow-left" size={15}/></button>
        <button className="icon-button light" disabled={!state.canGoForward} title="Avançar" onClick={() => void bridge?.chatgpt.forward()}><Icon name="arrow-right" size={15}/></button>
        <button className="icon-button light" title="Recarregar ChatGPT" onClick={() => void bridge?.chatgpt.reload()}><Icon name="refresh" size={15}/></button>
        <button className="icon-button light" title="Abrir ChatGPT no navegador do sistema" onClick={() => void bridge?.chatgpt.openExternal()}><Icon name="external" size={15}/></button>
        <button className="icon-button light" title="Colar clipboard no campo focado do ChatGPT" onClick={() => void bridge?.chatgpt.paste()}><Icon name="clipboard" size={15}/></button>
      </div>
      <div className="desktop-browser-address" title={state.url}><span className={state.loading ? 'browser-lamp loading' : 'browser-lamp'} /><strong>{chatTitle}</strong><span>{safeHost(state.url)}</span></div>
      <StatusPill tone={chatgptUrl ? 'success' : 'neutral'}>{chatgptUrl ? 'Chat vinculado' : 'A vincular'}</StatusPill>
    </div>

    {mismatch && <div className="chatgpt-link-warning"><span>Está a visualizar outra conversa do ChatGPT.</span><button className="text-button" onClick={bindCurrentConversation}>Vincular esta conversa</button></div>}

    <div className="desktop-chatgpt-actions">
      <div className="desktop-step"><span>1</span><button className="secondary-button" disabled={busy} onClick={() => void copyContext()}><Icon name="copy" size={15}/> Copiar contexto ZIP</button><small>Clique no composer e use Ctrl+V ou o botão Colar.</small></div>
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

function safeHost(value: string) { try { return new URL(value).host } catch { return 'chatgpt.com' } }
