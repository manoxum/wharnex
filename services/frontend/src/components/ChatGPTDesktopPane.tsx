import { useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import { api } from '../lib/api'
import { chatgptAutoBindingDecision, chatgptConversationURL, desktopBridge, elementBounds, formatBytes, sameChatGPTConversation } from '../lib/desktop'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'

const CHATGPT_HOME = 'https://chatgpt.com/'

export function ChatGPTDesktopPane({ suspended = false, session, manualPrompt, busy, chatId, chatTitle, chatgptUrl, onChatGPTURL, onContextSent, onSession, onManualPlan, onPlanFile, onBundleFile }: {
  suspended?: boolean
  session: Session
  manualPrompt: string
  busy: boolean
  chatId: string
  chatTitle: string
  chatgptUrl?: string
  onChatGPTURL: (url: string) => void
  onContextSent?: (sha256: string, conversationUrl?: string) => void
  onSession: (session: Session) => void
  onManualPlan: (json: string) => Promise<void>
  onPlanFile: (json: string, requestId: string) => Promise<string>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const newChatSurfaceSeenRef = useRef(false)
  const linkedURLRef = useRef(chatgptUrl)
  const chatIdRef = useRef(chatId)
  const onURLRef = useRef(onChatGPTURL)
  const onPlanFileRef = useRef(onPlanFile)
  const onBundleFileRef = useRef(onBundleFile)
  const [state, setState] = useState<DesktopChatGPTState>({ url: CHATGPT_HOME, title: 'ChatGPT', loading: true, canGoBack: false, canGoForward: false, authMode: 'external', authWindowOpen: false })
  const [notice, setNotice] = useState('')
  const [linkReady, setLinkReady] = useState(false)
  const [manualJSON, setManualJSON] = useState('')
  const [externalAuth, setExternalAuth] = useState<{ provider: string; url: string } | null>(null)
  const bridge = desktopBridge()

  useEffect(() => { chatIdRef.current = chatId; linkedURLRef.current = chatgptUrl; onURLRef.current = onChatGPTURL; onPlanFileRef.current = onPlanFile; onBundleFileRef.current = onBundleFile }, [chatId, chatgptUrl, onChatGPTURL, onPlanFile, onBundleFile])

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
    // Visibility is owned exclusively by the suspended/chatId effect below.
    // Showing here races a trusted overlay on mount (show -> hide) and can
    // paint the native WebContentsView above the Wharness modal.
    void bridge.chatgpt.state().then((next) => {
      setState(next)
      if (next.externalAuthProvider) setExternalAuth({ provider: next.externalAuthProvider, url: '' })
    })
    const unsubscribe = bridge.chatgpt.onState((next) => {
      setState(next)
      if (next.externalAuthProvider) setExternalAuth((current) => current || { provider: next.externalAuthProvider || 'OpenAI', url: '' })
      const decision = chatgptAutoBindingDecision(linkedURLRef.current, next.url, next.loading, newChatSurfaceSeenRef.current)
      newChatSurfaceSeenRef.current = decision.newChatSurfaceSeen
      if (decision.bindURL) {
        linkedURLRef.current = decision.bindURL
        onURLRef.current(decision.bindURL)
        newChatSurfaceSeenRef.current = false
        setNotice('Conversa ChatGPT definitiva vinculada automaticamente a este chat do Harness.')
      }
    })
    const unsubscribeAuth = bridge.chatgpt.onExternalAuth(({ cacheKey, provider, url }) => {
      if (cacheKey && cacheKey !== chatIdRef.current) return
      setExternalAuth({ provider, url })
      setNotice(`${provider}: autenticação aberta num Chrome/Chromium/Brave real gerido temporariamente pelo Wharness. Após o callback, apenas os cookies ChatGPT necessários são transferidos para a partition incorporada e o navegador externo é fechado.`)
    })
    const unsubscribeAuthComplete = bridge.chatgpt.onAuthComplete(({ cacheKey, authMode }) => {
      if (cacheKey && cacheKey !== chatIdRef.current) return
      setExternalAuth(null)
      setNotice(authMode === 'external' ? 'Autenticação externa concluída. Callback recebido e sessão incorporada retomada.' : 'Autenticação incorporada concluída.')
      void bridge.chatgpt.state().then(setState)
    })
    const unsubscribeAuthError = bridge.chatgpt.onAuthError(({ cacheKey, provider, message }) => {
      if (cacheKey && cacheKey !== chatIdRef.current) return
      setExternalAuth(null)
      setNotice(`${provider}: ${message}`)
      void bridge.chatgpt.state().then(setState)
    })
    const unsubscribePlan = bridge.chatgpt.onPlanDownloaded(({ filename, requestId, text, bytes }) => {
      setManualJSON(text)
      setNotice(`Plano ${filename} descarregado (${formatBytes(bytes)}). A importar automaticamente…`)
      void onPlanFileRef.current(text, requestId)
        .then((message) => setNotice(message))
        .catch((error) => setNotice(error instanceof Error ? error.message : 'Falha ao importar o ficheiro de plano.'))
    })
    const unsubscribePlanError = bridge.chatgpt.onPlanDownloadError(({ message }) => setNotice(message))
    const unsubscribeBundle = bridge.chatgpt.onBundleDownloaded(({ filename, requestId, contentBase64, bytes, sourceFilename, normalizedFilename }) => {
      const normalized = normalizedFilename && sourceFilename && sourceFilename !== filename ? ` Nome recebido: ${sourceFilename}; normalizado para ${filename}.` : ''
      setNotice(`Bundle ${filename} descarregado (${formatBytes(bytes)}).${normalized} A importar automaticamente…`)
      void onBundleFileRef.current(contentBase64, requestId, filename)
        .then((message) => setNotice(message))
        .catch((error) => setNotice(error instanceof Error ? error.message : 'Falha ao importar o bundle de execução.'))
    })
    const unsubscribeBundleError = bridge.chatgpt.onBundleDownloadError(({ message }) => setNotice(message))
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', sync)
      unsubscribe(); unsubscribeAuth(); unsubscribeAuthComplete(); unsubscribeAuthError(); unsubscribePlan(); unsubscribePlanError(); unsubscribeBundle(); unsubscribeBundleError(); void bridge.chatgpt.hide()
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    if (suspended || externalAuth) {
      void bridge.chatgpt.hide()
      return
    }
    void bridge.chatgpt.show(elementBounds(hostRef.current), chatId)
  }, [bridge, chatId, suspended, externalAuth])

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
      setNotice(`Contexto ZIP copiado como ficheiro (${formatBytes(result.bytes)}). ${externalAuth ? 'Aguarde o callback da autenticação externa antes de continuar.' : 'Clique no campo do ChatGPT e prima Ctrl+V.'}`)
      if (!externalAuth) await bridge.chatgpt.focus()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Falha ao copiar o contexto ZIP.') }
  }

  async function copyPrompt() {
    if (!manualPrompt) return
    if (bridge) await bridge.clipboard.writeText(manualPrompt)
    else await navigator.clipboard.writeText(manualPrompt)
    setNotice(externalAuth ? 'Prompt copiado. Aguarde o callback da autenticação externa antes de continuar.' : 'Prompt copiado. Clique no campo do ChatGPT e prima Ctrl+V.')
    if (!externalAuth) await bridge?.chatgpt.focus()
  }

  async function sendContext() {
    if (!bridge || externalAuth) return
    setNotice('A atualizar e enviar o contexto para o chat aberto…')
    try {
      const refreshed = await api.refreshContext(session.id)
      onSession(refreshed)
      const result = await bridge.chatgpt.attachContext({ cacheKey: chatId, sessionId: refreshed.id, url: chatgptUrl })
      if (result.conversationUrl && result.conversationUrl !== chatgptUrl) onChatGPTURL(result.conversationUrl)
      onContextSent?.(refreshed.context.manifest.sha256, result.conversationUrl || chatgptUrl)
      setNotice(`Contexto ZIP enviado diretamente ao ChatGPT (${formatBytes(result.bytes)}).`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Falha ao enviar o contexto ZIP.') }
  }

  async function sendPrompt() {
    if (!bridge || !manualPrompt || externalAuth) return
    setNotice('A enviar o prompt para o chat aberto…')
    try {
      const result = await bridge.chatgpt.attachPrompt({ cacheKey: chatId, text: manualPrompt, url: chatgptUrl })
      if (result.conversationUrl && result.conversationUrl !== chatgptUrl) onChatGPTURL(result.conversationUrl)
      setNotice(`Prompt enviado diretamente ao ChatGPT (${formatBytes(result.bytes)}).`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Falha ao enviar o prompt.') }
  }

  async function pastePlanFromClipboard() {
    try {
      const text = bridge ? await bridge.clipboard.readText() : await navigator.clipboard.readText()
      setManualJSON(text); setNotice('Resposta do clipboard colocada no campo JSON. Confirme e valide o plano.')
    } catch { setNotice('Não foi possível ler texto do clipboard. Cole o JSON manualmente.') }
  }

  async function importExternalBundle() {
    if (!bridge || !session.last_request_id) { setNotice('Ainda não existe um request_id ativo para validar o bundle.'); return }
    try {
      const result = await bridge.chatgpt.pickBundle({ requestId: session.last_request_id })
      if (result.cancelled) { setNotice('Importação do bundle cancelada.'); return }
      if (!result.filename || !result.requestId || !result.contentBase64) throw new Error('O Desktop não devolveu um bundle válido.')
      const normalized = result.normalizedFilename && result.sourceFilename && result.sourceFilename !== result.filename
        ? ` Nome recebido: ${result.sourceFilename}; normalizado para ${result.filename}.`
        : ''
      setNotice(`Bundle ${result.filename} selecionado (${formatBytes(result.bytes || 0)}).${normalized} A importar…`)
      const message = await onBundleFileRef.current(result.contentBase64, result.requestId, result.filename)
      setNotice(message)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Falha ao importar o bundle externo.') }
  }

  async function startAuthentication(mode: DesktopChatGPTAuthMode) {
    if (!bridge) return
    setNotice(mode === 'embedded'
      ? 'A iniciar login incorporado. E-mail/senha e provedores compatíveis permanecem no Wharness; se o Google bloquear o WebView, o fluxo muda automaticamente para navegador seguro.'
      : 'A abrir um Chrome/Chromium/Brave real com o perfil persistente do Wharness. A conta Google/ChatGPT será reutilizada nas próximas autenticações e o callback regressará automaticamente ao Wharness.')
    try {
      const next = await bridge.chatgpt.startAuth(chatId, mode)
      setState(next)
      if (mode === 'embedded') setExternalAuth(null)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível iniciar a autenticação ChatGPT.') }
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
  const expectedBundleFilename = session.last_request_id ? `wharness-bundle-${session.last_request_id}.zip` : 'wharness-bundle-<request_id>.zip'

  return <div className="desktop-chatgpt-shell">
    <div className="desktop-chatgpt-toolbar">
      <div className="desktop-browser-controls">
        <button className="icon-button light" disabled={!state.canGoBack} title="Voltar" onClick={() => void bridge?.chatgpt.back()}><Icon name="arrow-left" size={15}/></button>
        <button className="icon-button light" disabled={!state.canGoForward} title="Avançar" onClick={() => void bridge?.chatgpt.forward()}><Icon name="arrow-right" size={15}/></button>
        <button className="icon-button light" title="Recarregar ChatGPT" onClick={() => void bridge?.chatgpt.reload()}><Icon name="refresh" size={15}/></button>
        <button className="icon-button light" title="Abrir ChatGPT no navegador do sistema (sessão separada, sem callback para o Wharness)" onClick={() => void bridge?.chatgpt.openExternal(linkedConversation || CHATGPT_HOME)}><Icon name="external" size={15}/></button>
        <button className="icon-button light" title="Colar clipboard no campo focado do ChatGPT" onClick={() => void bridge?.chatgpt.paste()}><Icon name="clipboard" size={15}/></button>
      </div>
      <div className="desktop-browser-address" title={state.url}><span className={state.loading ? 'browser-lamp loading' : 'browser-lamp'} /><strong>{chatTitle}</strong><span>{safeHost(state.url)}</span></div>
      <StatusPill tone={!externalAuth && linkedConversation && (!currentConversation || sameConversation) ? 'success' : 'neutral'}>{externalAuth ? 'Login seguro externo' : linkedConversation ? (mismatch ? 'Outra conversa' : 'Chat vinculado') : 'A vincular'}</StatusPill>
    </div>

    <div className="chatgpt-auth-mode-bar">
      <div className="chatgpt-auth-mode-copy"><strong>Autenticação</strong><span>Escolha o modo de login. Incorporado usa o Chromium do Wharness; Google pode recusá-lo e será encaminhado automaticamente. Externo (callback) usa um perfil Chrome dedicado e persistente do Wharness, preservando a conta Google/ChatGPT entre autenticações. O Chrome pessoal pode ser aberto à parte com a sessão já existente, mas não é inspecionado nem usado para importar cookies.</span></div>
      <div className="chatgpt-auth-mode-actions" role="group" aria-label="Modo de autenticação ChatGPT">
        <button className={state.authMode === 'embedded' ? 'secondary-button active' : 'text-button'} type="button" disabled={busy} onClick={() => void startAuthentication('embedded')}>Login incorporado</button>
        <button className={state.authMode !== 'embedded' ? 'secondary-button active' : 'text-button'} type="button" disabled={busy} onClick={() => void startAuthentication('external')}><Icon name="external" size={13}/> Login externo (callback)</button>
        <button className="text-button" type="button" disabled={busy} title="Abre o Chrome/navegador pessoal com o perfil e a sessão atuais. Esta sessão permanece isolada do Wharness." onClick={() => void bridge?.chatgpt.openExternal(linkedConversation || CHATGPT_HOME)}><Icon name="external" size={13}/> Chrome pessoal</button>
      </div>
    </div>

    {mismatch && <div className="chatgpt-link-warning"><span>Está a visualizar outra conversa do ChatGPT.</span><button className="text-button" onClick={bindCurrentConversation}>Vincular esta conversa</button></div>}

    {externalAuth && <div className="chatgpt-external-auth-banner">
      <div><strong>Autenticação externa — {externalAuth.provider}</strong><span>Conclua o login no Chrome/Chromium/Brave aberto pelo Wharness. O perfil é dedicado e persistente: depois do primeiro login, a conta Google e a sessão ChatGPT ficam disponíveis nas próximas autenticações. Ao regressar autenticado a chatgpt.com, o Wharness deteta o callback, transfere somente cookies ChatGPT para a partition incorporada e fecha a janela externa sem apagar o perfil.</span></div>
      <div className="chatgpt-external-auth-actions">
        <button className="secondary-button" type="button" onClick={() => void startAuthentication('external')}><Icon name="external" size={14}/> Reabrir login</button>
        <button className="text-button" type="button" onClick={() => void startAuthentication('embedded')}>Usar incorporado</button>
      </div>
    </div>}

    <div className="desktop-chatgpt-actions">
      <article className="desktop-action-card">
        <div className="desktop-action-head"><span className="desktop-action-icon"><Icon name="workspace" size={15}/></span><div><strong>Contexto do projeto</strong><small>ZIP atualizado quando a conversa ou o snapshot muda.</small></div></div>
        <div className="desktop-action-buttons"><button className="desktop-action-button" disabled={busy} onClick={() => void copyContext()}><Icon name="copy" size={13}/> Copiar ZIP</button><button className="desktop-action-button primary" disabled={busy || Boolean(externalAuth)} onClick={() => void sendContext()}><Icon name="send" size={13}/> Enviar ZIP</button></div>
      </article>
      <article className="desktop-action-card">
        <div className="desktop-action-head"><span className="desktop-action-icon"><Icon name="plan" size={15}/></span><div><strong>Prompt atual</strong><small>Copie ou envie diretamente para o chat aberto.</small></div></div>
        <div className="desktop-action-buttons"><button className="desktop-action-button" disabled={!manualPrompt} onClick={() => void copyPrompt()}><Icon name="copy" size={13}/> Copiar prompt</button><button className="desktop-action-button primary" disabled={!manualPrompt || busy || Boolean(externalAuth)} onClick={() => void sendPrompt()}><Icon name="send" size={13}/> Enviar prompt</button></div>
      </article>
      <article className="desktop-action-card result">
        <div className="desktop-action-head"><span className="desktop-action-icon"><Icon name="download" size={15}/></span><div><strong>Resultado</strong><small>Bundle esperado para o pedido ativo.</small></div></div>
        <code className="desktop-bundle-name">{expectedBundleFilename}</code>
        {externalAuth && <button className="desktop-action-button" type="button" disabled={!session.last_request_id || busy} onClick={() => void importExternalBundle()}><Icon name="download" size={13}/> Importar bundle ZIP</button>}
      </article>
    </div>
    {notice && <div className="desktop-chatgpt-notice">{notice}</div>}

    <div ref={hostRef} className="desktop-chatgpt-host" aria-label="ChatGPT incorporado">{externalAuth ? <div className="desktop-chatgpt-external-placeholder"><Icon name="external" size={28}/><strong>Autenticação em navegador seguro</strong><span>Conclua o login no Chrome/Chromium/Brave aberto pelo Wharness. Após o callback, esta vista será reativada já autenticada.</span></div> : <div className="desktop-chatgpt-loading">A carregar ChatGPT…</div>}</div>

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
