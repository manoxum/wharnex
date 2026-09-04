import { useEffect, useRef, useState } from 'react'
import { chatgptAutoBindingDecision, chatgptConversationURL, desktopBridge, elementBounds, formatBytes, sameChatGPTConversation } from '../lib/desktop'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'

const CHATGPT_HOME = 'https://chatgpt.com/'
const CHATGPT_CONTROLS_KEY = 'wharness:chatgpt-auth-controls-expanded'

export function ChatGPTDesktopPane({ suspended = false, busy, chatId, chatTitle, chatgptUrl, onChatGPTURL, onPlanFile, onBundleFile, onActivity }: {
  suspended?: boolean
  busy: boolean
  chatId: string
  chatTitle: string
  chatgptUrl?: string
  onChatGPTURL: (url: string) => boolean
  onPlanFile: (json: string, requestId: string) => Promise<string>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
  onActivity?: (activity: DesktopChatGPTActivity) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const newChatSurfaceSeenRef = useRef(false)
  const linkedURLRef = useRef(chatgptUrl)
  const chatIdRef = useRef(chatId)
  const onURLRef = useRef(onChatGPTURL)
  const onPlanFileRef = useRef(onPlanFile)
  const onBundleFileRef = useRef(onBundleFile)
  const onActivityRef = useRef(onActivity)
  const [state, setState] = useState<DesktopChatGPTState>({ url: CHATGPT_HOME, title: 'ChatGPT', loading: true, canGoBack: false, canGoForward: false, authMode: 'external', authWindowOpen: false })
  const [notice, setNotice] = useState('')
  const [linkReady, setLinkReady] = useState(false)
  const [externalAuth, setExternalAuth] = useState<{ provider: string; url: string } | null>(null)
  const [overlayBlocked, setOverlayBlocked] = useState(false)
  const [controlsExpanded, setControlsExpanded] = useState(() => {
    try { return window.localStorage.getItem(CHATGPT_CONTROLS_KEY) === '1' } catch { return false }
  })
  const bridge = desktopBridge()

  useEffect(() => {
    chatIdRef.current = chatId
    linkedURLRef.current = chatgptUrl
    onURLRef.current = onChatGPTURL
    onPlanFileRef.current = onPlanFile
    onBundleFileRef.current = onBundleFile
    onActivityRef.current = onActivity
  }, [chatId, chatgptUrl, onChatGPTURL, onPlanFile, onBundleFile, onActivity])

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { if (hostRef.current) void bridge.chatgpt.setBounds(elementBounds(hostRef.current), chatIdRef.current) })
    }
    const observer = new ResizeObserver(sync)
    observer.observe(hostRef.current)
    window.addEventListener('resize', sync)
    void bridge.chatgpt.state(chatIdRef.current).then((next) => {
      if (next.cacheKey && next.cacheKey !== chatIdRef.current) return
      setState(next)
      if (next.externalAuthProvider) setExternalAuth({ provider: next.externalAuthProvider, url: '' })
    })
    const unsubscribe = bridge.chatgpt.onState((next) => {
      if (next.cacheKey && next.cacheKey !== chatIdRef.current) return
      setState(next)
      if (next.externalAuthProvider) setExternalAuth((current) => current || { provider: next.externalAuthProvider || 'OpenAI', url: '' })
      const decision = chatgptAutoBindingDecision(linkedURLRef.current, next.url, next.loading, newChatSurfaceSeenRef.current)
      newChatSurfaceSeenRef.current = decision.newChatSurfaceSeen
      if (decision.bindURL) {
        if (onURLRef.current(decision.bindURL)) {
          linkedURLRef.current = decision.bindURL
          newChatSurfaceSeenRef.current = false
          setNotice('Conversa ChatGPT vinculada automaticamente a este chat.')
        } else {
          setNotice('Esta conversa já pertence a outro chat do Wharness.')
        }
      }
    })
    const unsubscribeAuth = bridge.chatgpt.onExternalAuth(({ cacheKey, provider, url }) => {
      if (cacheKey && cacheKey !== chatIdRef.current) return
      setExternalAuth({ provider, url })
      setNotice(`${provider}: conclua a autenticação no navegador seguro aberto pelo Wharness.`)
    })
    const unsubscribeAuthComplete = bridge.chatgpt.onAuthComplete(({ cacheKey }) => {
      if (cacheKey && cacheKey !== chatIdRef.current) return
      setExternalAuth(null); setControlsExpanded(false); setNotice('Sessão ChatGPT autenticada.')
      void bridge.chatgpt.state(chatIdRef.current).then((next) => {
        if (!next.cacheKey || next.cacheKey === chatIdRef.current) setState(next)
      })
    })
    const unsubscribeAuthError = bridge.chatgpt.onAuthError(({ cacheKey, provider, message }) => {
      if (cacheKey && cacheKey !== chatIdRef.current) return
      setExternalAuth(null); setControlsExpanded(true); setNotice(`${provider}: ${message}`)
      void bridge.chatgpt.state(chatIdRef.current).then((next) => {
        if (!next.cacheKey || next.cacheKey === chatIdRef.current) setState(next)
      })
    })
    const unsubscribePlan = bridge.chatgpt.onPlanDownloaded(({ cacheKey, filename, requestId, text, bytes }) => {
      if (!cacheKey || cacheKey !== chatIdRef.current) return
      setNotice(`Plano ${filename} recebido (${formatBytes(bytes)}). A importar…`)
      void onPlanFileRef.current(text, requestId).then(setNotice).catch((error) => setNotice(error instanceof Error ? error.message : 'Falha ao importar o plano.'))
    })
    const unsubscribePlanError = bridge.chatgpt.onPlanDownloadError(({ cacheKey, message }) => { if (cacheKey === chatIdRef.current) setNotice(message) })
    const unsubscribeBundle = bridge.chatgpt.onBundleDownloaded(({ cacheKey, filename, requestId, contentBase64, bytes }) => {
      if (!cacheKey || cacheKey !== chatIdRef.current) return
      setNotice(`Bundle ${filename} recebido (${formatBytes(bytes)}). A importar…`)
      void onBundleFileRef.current(contentBase64, requestId, filename).then(setNotice).catch((error) => setNotice(error instanceof Error ? error.message : 'Falha ao importar o bundle.'))
    })
    const unsubscribeBundleError = bridge.chatgpt.onBundleDownloadError(({ cacheKey, message, error }) => { if (cacheKey === chatIdRef.current) setNotice(message || error || 'Falha ao receber o bundle.') })
    const unsubscribeActivity = bridge.chatgpt.onActivity((activity) => { if (!activity.cacheKey || activity.cacheKey === chatIdRef.current) onActivityRef.current?.(activity) })
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', sync)
      unsubscribe(); unsubscribeAuth(); unsubscribeAuthComplete(); unsubscribeAuthError(); unsubscribePlan(); unsubscribePlanError(); unsubscribeBundle(); unsubscribeBundleError(); unsubscribeActivity(); void bridge.chatgpt.hide(chatIdRef.current)
    }
  }, [bridge])

  useEffect(() => {
    const selector = '[role="dialog"][aria-modal="true"], [data-chatgpt-overlay-blocker="true"]'
    const sync = () => setOverlayBlocked(Boolean(document.querySelector(selector)))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    if (suspended || overlayBlocked || externalAuth) { void bridge.chatgpt.hide(chatIdRef.current); return }
    void bridge.chatgpt.show(elementBounds(hostRef.current), chatId)
  }, [bridge, chatId, suspended, overlayBlocked, externalAuth])

  useEffect(() => {
    if (!bridge || !chatId) return
    let alive = true
    linkedURLRef.current = chatgptUrl
    newChatSurfaceSeenRef.current = false
    setLinkReady(false)
    const target = chatgptUrl || CHATGPT_HOME
    setNotice(chatgptUrl ? `A recuperar “${chatTitle}”…` : `Novo chat “${chatTitle}”: aguardando URL definitiva do ChatGPT.`)
    void bridge.chatgpt.navigate(target, chatId, { resetToHomeIfConversation: !chatgptUrl }).then((next) => {
      if (!alive) return
      setState(next); setLinkReady(true)
      const linkedConversation = chatgptConversationURL(linkedURLRef.current || '')
      if (linkedConversation && linkedURLRef.current !== linkedConversation && onURLRef.current(linkedConversation)) linkedURLRef.current = linkedConversation
      if (!linkedConversation) {
        const decision = chatgptAutoBindingDecision(undefined, next.url, next.loading, false)
        newChatSurfaceSeenRef.current = decision.newChatSurfaceSeen
      }
    }).catch((error) => { if (alive) setNotice(error instanceof Error ? error.message : 'Não foi possível abrir a conversa ChatGPT.') })
    return () => { alive = false; newChatSurfaceSeenRef.current = false; setLinkReady(false) }
  }, [bridge, chatId, chatTitle, chatgptUrl])

  async function startAuthentication(mode: DesktopChatGPTAuthMode) {
    if (!bridge) return
    try {
      const next = await bridge.chatgpt.startAuth(chatId, mode)
      setState(next)
      if (mode === 'embedded') setExternalAuth(null)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível iniciar a autenticação ChatGPT.') }
  }

  function toggleControls() {
    setControlsExpanded((current) => {
      const next = !current
      try { window.localStorage.setItem(CHATGPT_CONTROLS_KEY, next ? '1' : '0') } catch { /* best effort */ }
      return next
    })
  }

  function bindCurrentConversation() {
    const conversation = chatgptConversationURL(state.url)
    if (!conversation) { setNotice('Abra primeiro uma conversa concreta do ChatGPT.'); return }
    if (!onChatGPTURL(conversation)) { setNotice('Esta conversa já está vinculada a outro chat.'); return }
    linkedURLRef.current = conversation
    setNotice('Conversa vinculada ao chat atual.')
  }

  const currentConversation = chatgptConversationURL(state.url)
  const linkedConversation = chatgptConversationURL(chatgptUrl || '')
  const sameConversation = sameChatGPTConversation(currentConversation, linkedConversation)
  const mismatch = Boolean(linkReady && !state.loading && linkedConversation && currentConversation && !sameConversation)
  const authenticated = Boolean(state.authenticated && !externalAuth)

  return <div className="desktop-chatgpt-shell">
    <div className="desktop-chatgpt-toolbar">
      <div className="desktop-browser-controls">
        <button className="icon-button light" disabled={!state.canGoBack} title="Voltar" onClick={() => void bridge?.chatgpt.back(chatId)}><Icon name="arrow-left" size={15}/></button>
        <button className="icon-button light" disabled={!state.canGoForward} title="Avançar" onClick={() => void bridge?.chatgpt.forward(chatId)}><Icon name="arrow-right" size={15}/></button>
        <button className="icon-button light" title="Recarregar ChatGPT" onClick={() => void bridge?.chatgpt.reload(chatId)}><Icon name="refresh" size={15}/></button>
        <button className="icon-button light" title="Abrir no navegador do sistema" onClick={() => void bridge?.chatgpt.openExternal(linkedConversation || CHATGPT_HOME)}><Icon name="external" size={15}/></button>
        <button className="icon-button light" title="Colar clipboard no campo focado" onClick={() => void bridge?.chatgpt.paste(chatId)}><Icon name="clipboard" size={15}/></button>
      </div>
      <div className="desktop-browser-address" title={state.url}><span className={state.loading ? 'browser-lamp loading' : 'browser-lamp'} /><strong>{chatTitle}</strong><span>{safeHost(state.url)}</span></div>
      <div className="desktop-chatgpt-toolbar-status">
        <StatusPill tone={!externalAuth && linkedConversation && (!currentConversation || sameConversation) ? 'success' : 'neutral'}>{externalAuth ? 'Login externo' : linkedConversation ? (mismatch ? 'Outra conversa' : 'Vinculado') : 'A vincular'}</StatusPill>
        <button className={`chatgpt-auth-indicator ${authenticated ? 'authenticated' : 'attention'}`} type="button" aria-label={authenticated ? 'Sessão ChatGPT autenticada' : 'Autenticação ChatGPT necessária'} title={authenticated ? 'Sessão ChatGPT autenticada · clique para opções' : 'Autenticar ChatGPT'} onClick={toggleControls}><Icon name={authenticated ? 'check' : 'shield'} size={15}/></button>
      </div>
    </div>

    {(controlsExpanded || !authenticated || Boolean(externalAuth)) && <div className="chatgpt-auth-compact-panel">
      {!authenticated && <strong>{externalAuth ? `Autenticação ${externalAuth.provider} em curso` : 'Autenticação necessária'}</strong>}
      <div className="chatgpt-auth-mode-actions" role="group" aria-label="Modo de autenticação ChatGPT">
        <button className={state.authMode === 'embedded' ? 'secondary-button active' : 'text-button'} type="button" disabled={busy} onClick={() => void startAuthentication('embedded')}>Incorporado</button>
        <button className={state.authMode !== 'embedded' ? 'secondary-button active' : 'text-button'} type="button" disabled={busy} onClick={() => void startAuthentication('external')}><Icon name="external" size={13}/> Externo</button>
        <button className="text-button" type="button" disabled={busy} onClick={() => void bridge?.chatgpt.openExternal(linkedConversation || CHATGPT_HOME)}><Icon name="external" size={13}/> Navegador</button>
      </div>
    </div>}

    {mismatch && <div className="chatgpt-link-warning"><span>Está a visualizar outra conversa.</span><button className="text-button" onClick={bindCurrentConversation}>Vincular esta</button></div>}
    {notice && <div className="desktop-chatgpt-notice">{notice}</div>}
    <div ref={hostRef} className="desktop-chatgpt-host" aria-label="ChatGPT incorporado">{externalAuth ? <div className="desktop-chatgpt-external-placeholder"><Icon name="external" size={28}/><strong>Autenticação externa</strong><span>Conclua o login no navegador seguro. O Wharness retomará esta vista automaticamente.</span></div> : <div className="desktop-chatgpt-loading">A carregar ChatGPT…</div>}</div>
  </div>
}

function safeHost(value: string) { try { return new URL(value).host } catch { return 'chatgpt.com' } }
