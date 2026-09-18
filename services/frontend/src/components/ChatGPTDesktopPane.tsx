import { useCallback, useEffect, useRef, useState } from 'react'
import { chatgptConversationURL, desktopBridge, elementBounds, formatBytes, sameChatGPTConversation } from '../lib/desktop'
import { Icon } from './Icon'
import { ChatBindingRecovery } from './ChatBindingRecovery'
import { StatusPill } from './StatusPill'
import { confirmDialog } from '../lib/appDialog'
import { expectedResponseBundleName } from '../lib/bundlename'
import { errorMessage } from '../lib/errorMessage'
import { observeChatGPTOverlayBlockers } from '../lib/chatGPTOverlay'

const CHATGPT_HOME = 'https://chatgpt.com/'
const CHATGPT_CONTROLS_KEY = 'wharness:chatgpt-auth-controls-expanded'
const AGENT_FOLLOW_EVENT = 'wharnex:agent-follow'

export function ChatGPTDesktopPane({ suspended = false, busy, chatId, chatTitle, chatgptUrl, pendingRequestId, sessionId, chatHash, requestedAt, recoveryBootstrap, onChatGPTURL, onPlanFile, onBundleFile, onActivity, onTransportFailure, onCancelPendingRequest }: {
  suspended?: boolean
  busy: boolean
  chatId: string
  chatTitle: string
  chatgptUrl?: string
  pendingRequestId?: string
  sessionId?: string
  chatHash?: string
  requestedAt?: string
  recoveryBootstrap?: string
  onChatGPTURL: (url: string) => boolean
  onPlanFile: (json: string, requestId: string) => Promise<string>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
  onActivity?: (activity: DesktopChatGPTActivity) => void
	 onTransportFailure?: (requestId: string, reason: string) => void
  onCancelPendingRequest?: (requestId: string) => Promise<void>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const linkedURLRef = useRef(chatgptUrl)
  const chatIdRef = useRef(chatId)
  const navigatedRef = useRef<{ chatId: string; chatgptUrl?: string } | null>(null)
  const onURLRef = useRef(onChatGPTURL)
  const onPlanFileRef = useRef(onPlanFile)
  const onBundleFileRef = useRef(onBundleFile)
  const onActivityRef = useRef(onActivity)
	const onTransportFailureRef = useRef(onTransportFailure)
  const [state, setState] = useState<DesktopChatGPTState>({ url: CHATGPT_HOME, title: 'ChatGPT', loading: true, canGoBack: false, canGoForward: false, authMode: 'embedded', authWindowOpen: false })
  const [notice, setNotice] = useState('')
  const [linkReady, setLinkReady] = useState(false)
  const deferredSurfaceRef = useRef(false)
  const [externalAuth, setExternalAuth] = useState<{ provider: string; url: string } | null>(null)
  const [overlayBlocked, setOverlayBlocked] = useState(false)
  const [requestAction, setRequestAction] = useState<'resume' | 'stop' | null>(null)
  const [followedAgentId, setFollowedAgentId] = useState('')
  const [agentRuntime, setAgentRuntime] = useState<DesktopAgentRuntimeState>()
  const [controlsExpanded, setControlsExpanded] = useState(() => {
    try { return window.localStorage.getItem(CHATGPT_CONTROLS_KEY) === '1' } catch { return false }
  })
  const bridge = desktopBridge()

  const applyDesktopState = useCallback((next: DesktopChatGPTState) => {
    if (next.cacheKey && next.cacheKey !== chatIdRef.current) return
    setState(next)
    if (next.surfaceDeferred) {
      deferredSurfaceRef.current = true
      setLinkReady(false)
      return
    }
    if (deferredSurfaceRef.current && !next.loading) {
      deferredSurfaceRef.current = false
      setLinkReady(true)
    }
    if (next.externalAuthProvider) {
      setExternalAuth((current) => current || { provider: next.externalAuthProvider || 'OpenAI', url: '' })
      return
    }
    if (!next.loading && isChatGPTAuthSurface(next.url)) {
      setControlsExpanded(true)
      setNotice('Autenticação necessária. Conclua o login incorporado ou escolha Externo.')
    }
  }, [])


  useEffect(() => {
    chatIdRef.current = chatId
    linkedURLRef.current = chatgptUrl
    onURLRef.current = onChatGPTURL
    onPlanFileRef.current = onPlanFile
    onBundleFileRef.current = onBundleFile
    onActivityRef.current = onActivity
		onTransportFailureRef.current = onTransportFailure
	}, [chatId, chatgptUrl, onChatGPTURL, onPlanFile, onBundleFile, onActivity, onTransportFailure])

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { if (hostRef.current) void bridge.chatgpt.setBounds(elementBounds(hostRef.current), chatIdRef.current) })
    }
    const observer = new ResizeObserver(sync)
    observer.observe(hostRef.current)
    // `show` can run while this flex host still measures at its 1×1 minimum.
    // ResizeObserver is not guaranteed to publish a later notification when
    // that first layout is coalesced, leaving the native WebContentsView loaded
    // but effectively invisible. Always send the post-layout bounds once.
    sync()
    window.addEventListener('resize', sync)
    void bridge.chatgpt.state(chatIdRef.current).then(applyDesktopState)
    const unsubscribe = bridge.chatgpt.onState(applyDesktopState)
    const unsubscribeAuth = bridge.chatgpt.onExternalAuth(({ cacheKey, provider, url }) => {
      if (cacheKey && cacheKey !== chatIdRef.current) return
      setExternalAuth({ provider, url })
      setNotice(`${provider}: conclua a autenticação no navegador seguro aberto pelo Wharnex.`)
    })
    const unsubscribeAuthComplete = bridge.chatgpt.onAuthComplete(({ cacheKey }) => {
      if (cacheKey && cacheKey !== chatIdRef.current) return
      setExternalAuth(null); setControlsExpanded(false); setNotice('Sessão ChatGPT autenticada.')
      void bridge.chatgpt.state(chatIdRef.current).then(applyDesktopState)
    })
    const unsubscribeAuthError = bridge.chatgpt.onAuthError(({ cacheKey, provider, message }) => {
      if (cacheKey && cacheKey !== chatIdRef.current) return
      setExternalAuth(null); setControlsExpanded(true); setNotice(`${provider}: ${message}`)
      void bridge.chatgpt.state(chatIdRef.current).then(applyDesktopState)
    })
    const unsubscribePlan = bridge.chatgpt.onPlanDownloaded(({ cacheKey, filename, requestId, text, bytes }) => {
      if (!cacheKey || cacheKey !== chatIdRef.current) return
      setNotice(`Plano ${filename} recebido (${formatBytes(bytes)}). A importar…`)
      void onPlanFileRef.current(text, requestId).then(setNotice).catch((error) => setNotice(error instanceof Error ? error.message : 'Falha ao importar o plano.'))
    })
    const unsubscribePlanError = bridge.chatgpt.onPlanDownloadError(({ cacheKey, message }) => { if (cacheKey === chatIdRef.current) setNotice(message) })
    const unsubscribeBundleError = bridge.chatgpt.onBundleDownloadError(({ cacheKey, requestId, message, error }) => {
		if (cacheKey !== chatIdRef.current) return
		const reason = message || error || 'Falha ao receber o bundle.'
		setNotice(`Falha de comunicação: ${reason}`)
		if (requestId) onTransportFailureRef.current?.(requestId, reason)
	})
    const unsubscribeActivity = bridge.chatgpt.onActivity((activity) => { if (!activity.cacheKey || activity.cacheKey === chatIdRef.current) onActivityRef.current?.(activity) })
    const unsubscribeAccount = bridge.chatgpt.onAccountAction?.((result) => {
      if (result.cacheKey !== chatIdRef.current) return
      if (result.action === 'organize') setNotice(result.ok ? `Conversa organizada no projeto via ${result.provider}.` : `A conversa continua vinculada, mas a organização remota requer atenção (${result.state}).`)
    }) || (() => {})
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', sync)
      unsubscribe(); unsubscribeAuth(); unsubscribeAuthComplete(); unsubscribeAuthError(); unsubscribePlan(); unsubscribePlanError(); unsubscribeBundleError(); unsubscribeActivity(); unsubscribeAccount(); void bridge.chatgpt.hide(chatIdRef.current)
    }
  }, [bridge, applyDesktopState])

  useEffect(() => observeChatGPTOverlayBlockers(window, (blocked) => {
    // A WebContentsView is composited above the renderer. Hide it in the
    // observer callback itself; waiting for React to commit state and run the
    // visibility effect leaves a visible frame in which the native surface can
    // cover a modal or even the next selected workspace surface.
    if (blocked) void bridge?.chatgpt.hide(chatIdRef.current)
    setOverlayBlocked(blocked)
  }), [bridge])

  useEffect(() => {
    const agents = bridge?.agents
    if (!agents) return
    let active = true
    void agents.state().then((next) => { if (active) setAgentRuntime(next) }).catch(() => {})
    const off = agents.onState((next) => { if (active) setAgentRuntime(next) })
    return () => { active = false; off() }
  }, [bridge])

  useEffect(() => {
    const onFollow = (event: Event) => {
      const agentId = String((event as CustomEvent<{ agentId?: string }>).detail?.agentId || '').trim()
      if (/^worker-[1-6]$/.test(agentId)) setFollowedAgentId(agentId)
    }
    window.addEventListener(AGENT_FOLLOW_EVENT, onFollow)
    return () => window.removeEventListener(AGENT_FOLLOW_EVENT, onFollow)
  }, [])

  useEffect(() => {
    const agents = bridge?.agents
    const host = hostRef.current
    if (!agents || !host || !followedAgentId) return
    // A trusted overlay/suspension always wins over a followed Worker: like
    // the Supervisor pane below, its WebContentsView paints above React and
    // must be closed — not merely resized behind the blocker — while one is
    // active, and reopened once it clears.
    if (suspended || overlayBlocked || externalAuth) {
      void agents.closeInteraction(followedAgentId).catch(() => {})
      return
    }
    let active = true
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (active && hostRef.current) void agents.setInteractionBounds(followedAgentId, elementBounds(hostRef.current)).catch(() => {})
      })
    }
    void bridge.chatgpt.hide(chatIdRef.current)
    void agents.openInteraction(followedAgentId, elementBounds(host)).catch((error) => {
      if (!active) return
      setFollowedAgentId('')
      setNotice(error instanceof Error ? error.message : 'Não foi possível seguir o Worker')
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
      void agents.closeInteraction(followedAgentId).catch(() => {})
      // Supervisor visibility itself is fully owned by the show/hide effect
      // below, which reacts to this same set of flags — re-showing it here
      // too would race that effect using this render's now-stale values.
    }
  }, [bridge, followedAgentId, suspended, overlayBlocked, externalAuth])

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    if (suspended || overlayBlocked || externalAuth || followedAgentId) { void bridge.chatgpt.hide(chatIdRef.current); return }
    void bridge.chatgpt.show(elementBounds(hostRef.current), chatId, chatgptUrl || CHATGPT_HOME)
  }, [bridge, chatId, suspended, overlayBlocked, externalAuth, followedAgentId])

  useEffect(() => {
    if (!bridge || !chatId) return
    if (suspended || overlayBlocked || externalAuth || followedAgentId || !hostRef.current) return
    // This is the single human-facing Supervisor pane. It remains mounted while
    // its chatId/url props move between chats; background automation is handled
    // by hidden Desktop workers rather than additional React panes.
    // `navigate` must still run every time this pane is unsuspended: its
    // backend handler already no-ops cheaply when the remote view is already
    // on the right conversation, but it is also what self-heals a view that
    // drifted away from its bound conversation (ChatGPT-side redirect,
    // session hiccup, a stray in-page "new chat") while this pane was
    // backgrounded. Skipping it outright left a drifted chat stuck on the
    // ChatGPT home page after switching back. Only the visible notice/link
    // "loading" reset is skipped on a repeat visit to the same chatId/url,
    // since that cosmetic reset — not the cheap backend check — is what
    // made an already-loaded chat look like it was reloading.
    const alreadyBound = navigatedRef.current?.chatId === chatId && navigatedRef.current?.chatgptUrl === chatgptUrl
    let alive = true
    linkedURLRef.current = chatgptUrl
    const target = chatgptUrl || CHATGPT_HOME
    const recoveryNotice = chatgptUrl ? 'A recuperar a conversa ChatGPT…' : ''
    const navigationNotice = recoveryNotice || 'Novo chat: aguardando URL definitiva do ChatGPT.'
    if (!alreadyBound) {
      setLinkReady(false)
      setNotice(navigationNotice)
    }
    void bridge.chatgpt.navigate(target, chatId, { resetToHomeIfConversation: !chatgptUrl, bounds: elementBounds(hostRef.current) }).then((next) => {
      if (!alive) return
      applyDesktopState(next)
      if (next.surfaceDeferred) {
        if (!alreadyBound) setNotice((current) => current === navigationNotice ? '' : current)
        return
      }
      navigatedRef.current = { chatId, chatgptUrl }
      setLinkReady(true)
      if (!alreadyBound && recoveryNotice) setNotice((current) => current === recoveryNotice ? '' : current)
      const linkedConversation = chatgptConversationURL(linkedURLRef.current || '')
      if (linkedConversation && linkedURLRef.current !== linkedConversation && onURLRef.current(linkedConversation)) linkedURLRef.current = linkedConversation
    }).catch((error) => { if (alive) setNotice(error instanceof Error ? error.message : 'Não foi possível abrir a conversa ChatGPT.') })
    return () => { alive = false }
  }, [bridge, chatId, chatgptUrl, suspended, overlayBlocked, externalAuth, applyDesktopState])

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
    if (!onChatGPTURL(conversation)) {
      setNotice('Esta conversa já está vinculada a outro chat.')
      return
    }
    linkedURLRef.current = conversation
    setNotice('Conversa vinculada ao chat atual.')
  }

  async function restoreLinkedConversation() {
    const conversation = chatgptConversationURL(chatgptUrl || '')
    if (!bridge || !conversation) return
    try {
      const next = await bridge.chatgpt.navigate(conversation, chatId)
      applyDesktopState(next)
      setNotice('Conversa vinculada reposta.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível repor a conversa vinculada.') }
  }

  async function continuePendingRequest() {
    if (!bridge || !pendingRequestId || requestAction) return
    setRequestAction('resume')
    try {
      let result = await bridge.chatgpt.continueExpectedBundle(chatId, pendingRequestId)
      if (!result.ok && result.reason === 'not_supervised') {
        const conversation = chatgptConversationURL(chatgptUrl || state.url)
        if (!sessionId || !conversation) {
          setNotice(manualContinuationFailure(result.reason))
          return
        }
        await bridge.chatgpt.resumeExpectedBundle({
          cacheKey: chatId,
          sessionId,
          requestId: pendingRequestId,
          url: conversation,
          recoveryBootstrap: recoveryBootstrap || '',
          expectedFilename: expectedResponseBundleName(recoveryBootstrap || '', pendingRequestId),
          chatTitle,
          chatHash,
          requestedAt,
        })
        result = await bridge.chatgpt.continueExpectedBundle(chatId, pendingRequestId)
      }
      if (result.confirmationRequired) {
        const staleTransport = result.reason === 'transport_stale'
        const confirmed = await confirmDialog({
          title: 'O estado de processamento é ambíguo',
          message: staleTransport
            ? 'O Wharnex detetou um transporte antigo sem atividade enquanto a conversa parece ociosa. Confirme apenas se verificou que a tarefa realmente parou.'
            : 'O ChatGPT ainda mostra um controlo de processamento, mas esse sinal pode estar desatualizado. Confirme apenas se verificou que a tarefa realmente parou.',
          tone: 'warning', confirmLabel: 'Continuar mesmo assim', cancelLabel: 'Aguardar',
        })
        if (!confirmed) return
        result = await bridge.chatgpt.continueExpectedBundle(chatId, pendingRequestId, { force: true })
      }
      if (!result.ok) {
        setNotice(manualContinuationFailure(result.reason))
        return
      }
      setNotice(`Continuação manual enviada para ${pendingRequestId}.`)
    } catch (error) {
      setNotice(errorMessage(error, 'Não foi possível retomar o pedido.'))
    } finally {
      setRequestAction(null)
    }
  }

  async function stopPendingRequest() {
    if (!pendingRequestId || !onCancelPendingRequest || requestAction) return
    setRequestAction('stop')
    try {
      // The backend owns the request identity. Reject a stale click before
      // stopping or clearing anything on the remote surface.
      await onCancelPendingRequest(pendingRequestId)
    } catch (error) {
      setNotice(`Não foi possível cancelar o pedido no WHX: ${errorMessage(error)}`)
      setRequestAction(null)
      return
    }
    const [remote, cleanup] = await Promise.allSettled([
      bridge ? bridge.chatgpt.stopConversation(chatId) : Promise.resolve({ ok: false, state: 'ponte indisponível' }),
      bridge ? bridge.chatgpt.cancelRequest(chatId, pendingRequestId) : Promise.resolve({ ok: false, cacheKey: chatId, requestId: pendingRequestId, cleared: false }),
    ])
    const cleanupFailure = cleanup.status === 'rejected' ? errorMessage(cleanup.reason) : ''
    if (remote.status === 'rejected' || cleanupFailure) {
      const details = [remote.status === 'rejected' ? `paragem remota: ${errorMessage(remote.reason)}` : '', cleanupFailure ? `limpeza da supervisão: ${cleanupFailure}` : ''].filter(Boolean).join('; ')
      setNotice(`Pedido ${pendingRequestId} cancelado no WHX; confirme o ChatGPT (${details}).`)
    } else if (!remote.value.ok) {
      setNotice(`Pedido ${pendingRequestId} cancelado localmente; confirme a paragem no ChatGPT (${remote.value.state}).`)
    } else {
      setNotice(`Pedido ${pendingRequestId} parado.`)
    }
    setRequestAction(null)
  }

  const workerAgents = (agentRuntime?.agents || []).filter((agent) => agent.role === 'worker' && agent.browser.available)
  const followedWorker = followedAgentId ? workerAgents.find((agent) => agent.id === followedAgentId) : undefined

  const selectEngineAgent = (agentId: string) => {
    if (!agentId) { setFollowedAgentId(''); return }
    const worker = workerAgents.find((agent) => agent.id === agentId)
    if (worker) setFollowedAgentId(worker.id)
  }

  const openCurrentDevTools = async () => {
    if (!bridge) return
    try {
      if (followedAgentId) await bridge.agents.openDevTools(followedAgentId)
      else await bridge.chatgpt.openDevTools(chatIdRef.current)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível abrir o DevTools desta instância')
    }
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
        <button className="icon-button light" title="Abrir no navegador interno" onClick={() => void bridge?.chatgpt.openInternal(linkedConversation || CHATGPT_HOME)}><Icon name="monitor" size={15}/></button>
        <button className="icon-button light" title="Colar clipboard no campo focado" onClick={() => void bridge?.chatgpt.paste(chatId)}><Icon name="clipboard" size={15}/></button>
      </div>
      <div className="desktop-browser-address" title={state.url}><span className={state.loading ? 'browser-lamp loading' : 'browser-lamp'} /><strong>{chatTitle}</strong><span>{safeHost(state.url)}</span></div>
      <div className="desktop-chatgpt-toolbar-status">
        <label className="desktop-engine-instance" title="Escolher a instância mostrada no Engine">
          <span>Instância</span>
          <select aria-label="Instância do Engine" value={followedAgentId} onChange={(event) => selectEngineAgent(event.target.value)}>
            <option value="">Supervisor</option>
            {followedAgentId && !followedWorker && <option value={followedAgentId}>{followedAgentId.replace('worker-', 'Worker ')}</option>}
            {workerAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
          </select>
        </label>
        <button className="icon-button light desktop-engine-devtools" type="button" aria-label="Abrir DevTools da instância atual" title={`Abrir DevTools · ${followedAgentId ? followedAgentId.replace('worker-', 'Worker ') : 'Supervisor'}`} onClick={() => void openCurrentDevTools()}><Icon name="code" size={15}/></button>
        <StatusPill tone={!externalAuth && linkedConversation && (!currentConversation || sameConversation) ? 'success' : 'neutral'}>{externalAuth ? 'Login externo' : linkedConversation ? (mismatch ? 'Outra conversa' : 'Vinculado') : 'A vincular'}</StatusPill>
        <button className={`chatgpt-auth-indicator ${authenticated ? 'authenticated' : 'attention'}`} type="button" aria-label={authenticated ? 'Sessão ChatGPT autenticada' : 'Autenticação ChatGPT necessária'} title={authenticated ? 'Sessão ChatGPT autenticada · clique para opções' : 'Autenticar ChatGPT'} onClick={toggleControls}><Icon name={authenticated ? 'check' : 'shield'} size={15}/></button>
      </div>
    </div>

    {(pendingRequestId || controlsExpanded || !authenticated || Boolean(externalAuth)) && <div className="chatgpt-auth-compact-panel">
      {!authenticated && <strong>{externalAuth ? `Autenticação ${externalAuth.provider} em curso` : 'Autenticação necessária'}</strong>}
      <div className="chatgpt-auth-mode-actions" role="group" aria-label="Modo de autenticação ChatGPT">
        <button className={state.authMode === 'embedded' ? 'secondary-button active' : 'text-button'} type="button" disabled={busy} onClick={() => void startAuthentication('embedded')}>Incorporado</button>
        <button className={state.authMode !== 'embedded' ? 'secondary-button active' : 'text-button'} type="button" disabled={busy} onClick={() => void startAuthentication('external')}><Icon name="external" size={13}/> Externo</button>
        <button className="text-button" type="button" disabled={busy} onClick={() => void bridge?.chatgpt.openExternal(linkedConversation || CHATGPT_HOME)}><Icon name="external" size={13}/> Navegador</button>
      </div>
      {pendingRequestId && <div className="chatgpt-request-toolbar" role="group" aria-label={`Pedido ${pendingRequestId} sob supervisão`}>
        <span className="chatgpt-request-chip" title={`Pedido ${pendingRequestId} sob supervisão`}><Icon name="bridge" size={12}/><code>{compactRequestId(pendingRequestId)}</code></span>
        <button className="text-button" type="button" disabled={busy || Boolean(requestAction)} onClick={() => void continuePendingRequest()}><Icon name="refresh" size={12}/>{requestAction === 'resume' ? 'A retomar…' : 'Retomar pedido'}</button>
        {onCancelPendingRequest && <button className="text-button danger" type="button" disabled={busy || Boolean(requestAction)} onClick={() => void stopPendingRequest()}><Icon name="close" size={12}/>{requestAction === 'stop' ? 'A parar…' : 'Parar pedido'}</button>}
      </div>}
    </div>}

    {mismatch && <div className="chatgpt-link-warning"><span>Está a visualizar outra conversa.</span><button className="text-button" onClick={() => void restoreLinkedConversation()}>Repor vinculada</button><button className="text-button" onClick={bindCurrentConversation}>Vincular esta</button></div>}
    {/* An unbound chat opens the ChatGPT home surface and looks indistinguishable
        from a brand-new one, so the way back has to be offered here rather than
        left to the operator's memory of which conversation it was. Only show
        recovery if the chat had messages (state.url !== home page). */}
    {!linkedConversation && !externalAuth && state.url !== CHATGPT_HOME && <ChatBindingRecovery chatId={chatId} onBind={onChatGPTURL} />}
    {notice && <div className="desktop-chatgpt-notice">{notice}</div>}
    {followedAgentId && <div className="desktop-chatgpt-follow"><div><Icon name="monitor" size={13}/><strong>Seguindo {followedAgentId.replace('worker-', 'Worker ')}</strong><small>Instância real do Worker em tempo real; o scheduler continua proprietário.</small></div><button type="button" className="text-button" onClick={() => setFollowedAgentId('')}>Parar de seguir</button></div>}
    <div ref={hostRef} className="desktop-chatgpt-host" aria-label="ChatGPT incorporado">{state.surfaceDeferred ? <div className="desktop-chatgpt-deferred"><Icon name="bridge" size={28}/><strong>A preparar este chat</strong><span>O Supervisor está a concluir o envio noutro chat. Este chat será carregado brevemente. Pode enviar novos prompts agora; ficarão em fila e serão enviados assim que este chat estiver pronto.</span></div> : externalAuth ? <div className="desktop-chatgpt-external-placeholder"><Icon name="external" size={28}/><strong>Autenticação externa</strong><span>Conclua o login no navegador seguro. O Wharnex retomará esta vista automaticamente.</span></div> : overlayBlocked ? <div className="desktop-chatgpt-suspended"><Icon name="chatgpt" size={24}/><strong>ChatGPT preservado</strong><span>A vista regressa ao fechar esta camada, na mesma conversa e posição.</span></div> : state.loading ? <div className="desktop-chatgpt-loading">A carregar ChatGPT…</div> : null}</div>
  </div>
}

function manualContinuationFailure(reason?: string) {
  if (reason === 'transport_active') return 'O ChatGPT ainda tem transporte de conversa ativo; o pedido não foi interrompido.'
  if (reason === 'surface_loading') return 'A conversa ChatGPT ainda está a carregar. Aguarde a estabilização antes de retomar.'
  if (reason === 'continuation_in_flight') return 'Já existe uma continuação manual deste pedido em curso.'
  if (reason === 'continuation_failed') return 'A continuação não pôde ser preparada. Consulte o alerta do ChatGPT e tente novamente depois de corrigir a causa indicada.'
  if (reason === 'not_supervised') return 'A supervisão local deste pedido ainda não foi restaurada nesta conversa.'
  return 'O pedido não foi retomado porque o estado remoto ainda não permite uma continuação segura.'
}

function safeHost(value: string) { try { return new URL(value).host } catch { return 'chatgpt.com' } }
function compactRequestId(value: string) { return value.length > 22 ? `${value.slice(0, 19)}…` : value }
function isChatGPTAuthSurface(value: string) { try { const path = new URL(value).pathname; return path === '/auth' || path.startsWith('/auth/') } catch { return false } }
