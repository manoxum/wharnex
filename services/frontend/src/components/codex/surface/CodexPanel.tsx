import { useEffect, useState } from 'react'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { useCodexStatus, type CodexThread } from '../../../lib/codex'
import { WorkbenchTabs } from '../../presentation/tabs'
import { CodexUsage } from './CodexUsage'
import { CodexConversation } from './CodexConversation'
import { CodexHeader } from './CodexHeader'
import { CodexAccounts } from '../accounts'

export function CodexPanel({ projectPath, chatId, onSelectChat }: { projectPath: string; chatId?: string; onSelectChat?: (chatId: string) => void }) {
  const { data, threads: liveThreads, error, loading, refresh } = useCodexStatus(projectPath)
  const [tab, setTab] = useState<'conversation' | 'usage' | 'configuration'>('conversation')
  const [selected, setSelected] = useState('')
  const [history, setHistory] = useState<CodexThread>()
  const [actionError, setActionError] = useState('')
  const selectedChat = chatId || selected
  const threads = liveThreads || data?.threads || []
  const connectionState = !desktopBridge()?.codex ? 'unavailable' : !data ? error ? 'error' : 'checking' : data.connected ? 'connected' : 'disconnected'
  const liveThread = threads.find((thread) => thread.chatId === selectedChat)
  const hasSelectedThread = Boolean(liveThread)
  const thread = liveThread?.messages.length ? liveThread : history?.chatId === selectedChat && history.projectPath === projectPath ? { ...history, ...liveThread, messages: history.messages } : liveThread
  useEffect(() => {
    let alive = true
    if (!selectedChat || !hasSelectedThread) return
    void desktopBridge()?.codex?.history(projectPath, selectedChat).then((value) => { if (alive) setHistory(value) }).catch(() => {})
    return () => { alive = false }
  }, [projectPath, selectedChat, hasSelectedThread])
  async function accountAction(action: 'login' | 'logout') {
    setActionError('')
    try { await desktopBridge()?.codex?.[action](projectPath); await refresh() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Falha na autenticação Codex.') }
  }
  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-whx-surface font-sans text-whx-text" aria-label="Controlo Codex">
    <CodexHeader status={data} loading={loading} available={Boolean(desktopBridge()?.codex)} onRefresh={() => void refresh()} onAccountAction={(action) => void accountAction(action)}/>
    <WorkbenchTabs label="Codex" value={tab} onChange={setTab} items={[{ id: 'conversation', label: 'Conversas', icon: 'chatgpt', badge: threads.length }, { id: 'usage', label: 'Consumo', icon: 'activity' }, { id: 'configuration', label: 'Configuração', icon: 'settings' }]}/>
    {(error || actionError) && <p role="alert" className="mx-4 my-3 rounded-lg border border-whx-warning/30 bg-whx-warning/5 p-3 text-[calc(11px*var(--ui-font-scale))] leading-5 text-whx-warning">{actionError || error}</p>}
    <div hidden={tab !== 'configuration'} className={tab === 'configuration' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}><CodexAccounts projectPath={projectPath} accounts={data?.accounts} refresh={refresh}/><p className="px-4 text-whx-label leading-relaxed text-whx-faint">Modelo, esforço e permissões são definidos no compositor de cada conversa. A conta selecionada será usada no próximo pedido ou numa continuação manual.</p></div>
    <div hidden={tab !== 'usage'} className={tab === 'usage' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}><CodexUsage status={data} thread={thread}/></div>
    <div hidden={tab !== 'conversation'} className={tab === 'conversation' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
      {Boolean(threads.length) && (!chatId || onSelectChat) && <label className="flex shrink-0 items-center gap-3 border-b border-whx-border-soft px-4 py-3 text-[calc(10px*var(--ui-font-scale))] text-whx-faint">Conversa<select aria-label="Conversas Codex" className="!min-w-0 !flex-1 !rounded-lg !border !border-whx-border-soft !bg-whx-muted !p-2 !text-[calc(11px*var(--ui-font-scale))] !text-whx-text focus-visible:!outline-whx-accent" value={selectedChat} onChange={(event) => { setSelected(event.target.value); onSelectChat?.(event.target.value) }}><option value="">Escolher conversa…</option>{threads.map((item) => <option key={item.chatId} value={item.chatId}>{item.title}</option>)}</select></label>}
      <CodexConversation thread={thread} connectionState={connectionState} accountLabel={data?.accounts?.profiles.find((profile) => profile.id === data.accounts?.selected)?.label}/>
    </div>
  </section>
}
