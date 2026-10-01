import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktopBridge, elementBounds } from '../../../lib/desktop/bridge/desktop'
import { Icon } from '../../presentation/chrome/Icon'
import { directChatGPTKey } from '../../../lib/chat/transport/directChatGPT'
import { MirrorSurface } from '../mirror/MirrorSurface'

const CHATGPT_HOME = 'https://chatgpt.com/'

// This surface deliberately exposes navigation only. It never registers bundle,
// activity, account-action or generated-response listeners.
export function DirectChatGPTPane({ projectPath, suspended = false }: { projectPath: string; suspended?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const key = directChatGPTKey(projectPath)
  const bridge = desktopBridge()
  const [state, setState] = useState<DesktopChatGPTState>({ url: CHATGPT_HOME, title: 'ChatGPT', loading: true, canGoBack: false, canGoForward: false })

  const acceptState = useCallback((next: DesktopChatGPTState) => {
    if (!next.cacheKey || next.cacheKey === key) setState(next)
  }, [key])

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { if (hostRef.current) void bridge.chatgpt.setBounds(elementBounds(hostRef.current), key) })
    }
    const observer = new ResizeObserver(sync)
    observer.observe(hostRef.current); window.addEventListener('resize', sync); sync()
    void bridge.chatgpt.state(key).then(acceptState)
    const unsubscribe = bridge.chatgpt.onState(acceptState)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', sync); unsubscribe(); void bridge.chatgpt.hide(key) }
  }, [acceptState, bridge, key])

  // The real view lives in the browser host; this pane mirrors it.
  const mirrorFrames = useMemo(() => bridge?.chatgpt.onMirrorFrame
    ? (callback: (frame: DesktopMirrorFrame) => void) => bridge.chatgpt.onMirrorFrame((frame) => { if (frame.cacheKey === key) callback(frame) })
    : undefined, [bridge, key])
  const mirrorInput = useMemo(() => bridge?.chatgpt.mirrorInput
    ? (input: DesktopMirrorInput) => bridge.chatgpt.mirrorInput(key, input)
    : undefined, [bridge, key])

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    if (suspended) { void bridge.chatgpt.hide(key); return }
    void bridge.chatgpt.show(elementBounds(hostRef.current), key, state.url || CHATGPT_HOME)
  }, [bridge, key, state.url, suspended])

  return <section className="direct-chatgpt-shell">
    <header className="direct-chatgpt-toolbar">
      <div><span className="browser-lamp"/><strong>ChatGPT livre</strong><small>Sem scraper ou automação WHX</small></div>
      <nav>
        <button disabled={!state.canGoBack} onClick={() => void bridge?.chatgpt.back(key)} aria-label="Voltar"><Icon name="arrow-left" size={14}/></button>
        <button disabled={!state.canGoForward} onClick={() => void bridge?.chatgpt.forward(key)} aria-label="Avançar"><Icon name="arrow-right" size={14}/></button>
        <button onClick={() => void bridge?.chatgpt.reload(key)} aria-label="Recarregar"><Icon name="refresh" size={14}/></button>
        <button onClick={() => void bridge?.chatgpt.openExternal(state.url || CHATGPT_HOME)} aria-label="Abrir externamente"><Icon name="external" size={14}/></button>
      </nav>
    </header>
    <div ref={hostRef} className="desktop-chatgpt-host direct-chatgpt-host" aria-label="ChatGPT livre incorporado">{mirrorFrames && mirrorInput ? <MirrorSurface subscribe={mirrorFrames} send={mirrorInput} label="ChatGPT livre (espelho do navegador real)"/> : null}</div>
  </section>
}
