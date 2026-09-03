import { useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import { api } from '../lib/api'
import { chatgptAutoBindingDecision, chatgptConversationURL, desktopBridge, elementBounds, formatBytes, sameChatGPTConversation } from '../lib/desktop'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'

const CHATGPT_HOME = 'https://chatgpt.com/'

export function ChatGPTDesktopPane({ session, manualPrompt, busy, chatId, chatTitle, chatgptUrl, onChatGPTURL, onSession, onManualPlan, onPlanFile, onBundleFile }: {
  session: Session
  manualPrompt: string
  busy: boolean
  chatId: string
  chatTitle: string
  chatgptUrl?: string
  onChatGPTURL: (url: string) => void
  onSession: (session: Session) => void
  onManualPlan: (json: string) => Promise<void>
  onPlanFile: (json: string, requestId: string) => Promise<string>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const newChatSurfaceSeenRef = useRef(false)
  const linkedURLRef = useRef(chatgptUrl)
  const onURLRef = useRef(onChatGPTURL)
  const onPlanFileRef = useRef(onPlanFile)
  const onBundleFileRef = useRef(onBundleFile)
  const [state, setState] = useState<DesktopChatGPTState>({ url: CHATGPT_HOME, title: 'ChatGPT', loading: true, canGoBack: false, canGoForward: false })
  const [notice, setNotice] = useState('')
  const [linkReady, setLinkReady] = useState(false)
  const [manualJSON, setManualJSON] = useState('')
  const bridge = desktopBridge()

  useEffect(() => { linkedURLRef.current = chatgptUrl; onURLRef.current = onChatGPTURL; onPlanFileRef.current = onPlanFile; onBundleFileRef.current = onBundleFile }, [chatgptUrl, onChatGPTURL, onPlanFile, onBundleFile])

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
    void bridge.chatgpt.show(elementBounds(hostRef.current), chatId)
    void bridge.chatgpt.state().then(setState)
    const unsubscribe = bridge.chatgpt.onState((next) => {
      setState(next)
      const decision = chatgptAutoBindingDecision(linkedURLRef.current, next.url, next.loading, newChatSurfaceSeenRef.current)
      newChatSurfaceSeenRef.current = decision.newChatSurfaceSeen
      if (decision.bindURL) {
        linkedURLRef.current = decision.bindURL
        onURLRef.current(decision.bindURL)
        newChatSurfaceSeenRef.current = false
        setNotice('Conversa ChatGPT definitiva vinculada automaticamente a este chat do Harness.')
      }
    })
    const unsubscribeAuth = bridge.chatgpt.onExternalAuth(({ provider }) => {
      setNotice(`${provider} foi aberto no navegador do sistema. A sessão remota do ChatGPT continua isolada no Wharness Desktop.`)
    })
    const unsubscribePlan = bridge.chatgpt.onPlanDownloaded(({ filename, requestId, text, bytes }) => {
      setManualJSON(text)
      setNotice(`Plano ${filename} descarregado (${formatBytes(bytes)}). A importar automaticamente…`)
      void onPlanFileRef.current(text, requestId)
        .then((message) => setNotice(message))
        .catch((error) => setNotice(error instanceof Error ? error.message : 'Falha ao importar o ficheiro de plano.'))
    })
    const unsubscribePlanError = bridge.chatgpt.onPlanDownloadError(({ message }) => setNotice(message))
    const unsubscribeBundle = bridge.chatgpt.onBundleDownloaded(({ filename, requestId, contentBase64, bytes }) => {
      setNotice(`Bundle ${filename} descarregado (${formatBytes(bytes)}). A importar automaticamente…`)
      void onBundleFileRef.current(contentBase64, requestId, filename)
        .then((message) => setNotice(message))
        .catch((error) => setNotice(error instanceof Error ? error.message : 'Falha ao importar o bundle de execução.'))
    })
    const unsubscribeBundleError = bridge.chatgpt.onBundleDownloadError(({ message }) => setNotice(message))
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', sync)
      unsubscribe(); unsubscribeAuth(); unsubscribePlan(); unsubscribePlanError(); unsubscribeBundle(); unsubscribeBundleError(); void bridge.chatgpt.hide()
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge || !chatId) return
    setManualJSON('')
    let alive = true
    linkedURLRef.current = chatgptUrl
    newChatSurfaceSeenRef.current = false
    setLinkReady(false)
    const target = chatgptUrl || CHATGPT_HOME
    setNotice(chatgptUrl ? `A recuperar a conversa ChatGPT vinculada a “${chatTitle}”…` : `Novo chat “${chatTitle}”: aguardando o ChatGPT criar uma URL definitiva /c/... antes de vincular.`)
    void bridge.chatgpt.navigate(target, chatId, { resetToHomeIfConversation: !chatgptUrl }).then((next) => {
      if (!alive) return
      setState(next)
      setLinkReady(true)
      const linkedConversation = chatgptConversationURL(linkedURLRef.current || '')
      if (linkedConversation && linkedURLRef.current !== linkedConversation) {
        linkedURLRef.current = linkedConversation
        onURLRef.current(linkedConversation)
      }
      if (!linkedConversation) {
        const decision = chatgptAutoBindingDecision(undefined, next.url, next.loading, false)
        newChatSurfaceSeenRef.current = decision.newChatSurfaceSeen
        setNotice(decision.newChatSurfaceSeen
          ? `Novo chat “${chatTitle}” pronto. O vínculo será criado somente quando o ChatGPT atribuir a URL definitiva da conversa.`
          : `Novo chat “${chatTitle}” ainda sem vínculo. A conversa que já estava aberta não será assumida; aguardando a página de novo chat e depois uma URL /c/....`)
      }
    }).catch((error) => {
      if (alive) setNotice(error instanceof Error ? error.message : 'Não foi possível abrir a conversa ChatGPT vinculada.')
    })
    return () => { alive = false; newChatSurfaceSeenRef.current = false; setLinkReady(false) }
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
  const linkedConversation = chatgptConversationURL(chatgptUrl || '')
  const sameConversation = sameChatGPTConversation(currentConversation, linkedConversation)
  const mismatch = Boolean(linkReady && !state.loading && linkedConversation && currentConversation && !sameConversation)

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
      <StatusPill tone={linkedConversation && (!currentConversation || sameConversation) ? 'success' : 'neutral'}>{linkedConversation ? (mismatch ? 'Outra conversa' : 'Chat vinculado') : 'A vincular'}</StatusPill>
    </div>

    {mismatch && <div className="chatgpt-link-warning"><span>Está a visualizar outra conversa do ChatGPT.</span><button className="text-button" onClick={bindCurrentConversation}>Vincular esta conversa</button></div>}

    <div className="desktop-chatgpt-actions">
      <div className="desktop-step"><span>1</span><button className="secondary-button" disabled={busy} onClick={() => void copyContext()}><Icon name="copy" size={15}/> Copiar contexto ZIP</button><small>Clique no composer e use Ctrl+V ou o botão Colar.</small></div>
      <div className="desktop-step"><span>2</span><button className="secondary-button" disabled={!manualPrompt} onClick={() => void copyPrompt()}><Icon name="copy" size={15}/> Copiar prompt</button><small>Depois do ZIP, cole o prompt no composer.</small></div>
      <div className="desktop-step"><span>3</span><strong className="desktop-step-title"><Icon name="download" size={15}/> Baixar resultado ZIP</strong><small>{session.automation_mode === 'auto' ? 'ChatGPT web requer que o download seja iniciado aqui. Depois disso, respostas são importadas; somente mudanças válidas seguem automaticamente para sandbox e host.' : 'Clique em Download no wharness-bundle-<request_id>.zip. Respostas ou planos serão importados automaticamente.'}</small></div>
    </div>
    {notice && <div className="desktop-chatgpt-notice">{notice}</div>}

    <div ref={hostRef} className="desktop-chatgpt-host" aria-label="ChatGPT incorporado"><div className="desktop-chatgpt-loading">A carregar ChatGPT…</div></div>

    <details className="desktop-plan-import desktop-plan-fallback">
      <summary>Fallback manual</summary>
      <p className="muted-copy">Use apenas se o ChatGPT responder inline apesar do contrato file-first. O fluxo normal é descarregar <code>wharness-bundle-{session.last_request_id || 'request_id'}.zip</code>. O JSON inline permanece apenas como fallback legado.</p>
      <div className="bridge-actions">
        <button className="text-button" type="button" onClick={() => void pastePlanFromClipboard()}><Icon name="clipboard" size={15}/> Ler JSON do clipboard</button>
      </div>
      <label className="field-label" htmlFor="desktop-manual-json">JSON manual</label>
      <div className="desktop-plan-import-row">
        <textarea id="desktop-manual-json" className="json-input compact" spellCheck={false} value={manualJSON} onChange={(event) => setManualJSON(event.target.value)} placeholder={'{\n  "protocol": "harness.execution/v1",\n  ...\n}'} />
        <button className="primary-button" disabled={busy || !manualJSON.trim()} onClick={() => onManualPlan(manualJSON)}>Validar plano</button>
      </div>
    </details>
  </div>
}

function safeHost(value: string) { try { return new URL(value).host } catch { return 'chatgpt.com' } }
