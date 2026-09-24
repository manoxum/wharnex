import { useCallback, useState } from 'react'
import { api } from '../lib/api'
import type { WorkspaceChatBindingCandidate } from '../types'
import { Icon } from './Icon'

const EVIDENCE_LABEL: Record<WorkspaceChatBindingCandidate['evidence'], string> = {
  agent_queue: 'fila de agentes deste chat',
  transcript: 'transcrição deste chat',
  session_events: 'histórico da sessão',
}

export function ChatBindingRecovery({ chatId, linkedUrl, onBind, onLinked }: {
  chatId: string
  linkedUrl?: string
  onBind: (url: string) => boolean
  onLinked?: () => void
}) {
  const [candidates, setCandidates] = useState<WorkspaceChatBindingCandidate[] | null>(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const search = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const recovery = await api.workspaceChatBindingRecovery(chatId)
      setCandidates(recovery.candidates)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao procurar o vínculo')
    } finally {
      setBusy(false)
    }
  }, [chatId])

  const bind = useCallback(async (url: string) => {
    if (!onBind(url)) {
      setError('Esse endereço não é uma conversa válida do ChatGPT.')
      return
    }
    try { await api.updateWorkspaceChatRemote(chatId, { chatgpt_url: url }) } catch { /* the renderer binding still applies */ }
    onLinked?.()
  }, [chatId, onBind, onLinked])

  return <section className="grid gap-3 rounded-xl border border-whx-border bg-whx-surface p-3 text-whx-text shadow-lg">
    <header className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-whx-accent"><Icon name="link" size={18}/></span>
      <div className="min-w-0 flex-1">
        <strong className="block text-base">{linkedUrl ? 'Conversa vinculada' : 'Este chat perdeu sua conversa'}</strong>
        <span className="mt-0.5 block text-sm leading-5 text-whx-faint">
          {linkedUrl ? 'Consulte o vínculo permanente usado pelo Engine.' : 'Recupere o vínculo com a conversa do ChatGPT.'}
        </span>
      </div>
    </header>

    {linkedUrl && <div className="rounded-lg border border-whx-border-soft bg-whx-elevated px-3 py-2">
      <span className="block text-xs font-semibold uppercase tracking-wide text-whx-faint">Vínculo atual</span>
      <code className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-sm text-whx-soft">{linkedUrl}</code>
    </div>}

    {!linkedUrl && <button type="button" className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-whx-accent/50 bg-whx-accent-soft px-3 text-sm font-semibold text-whx-text transition hover:bg-whx-hover disabled:cursor-default disabled:opacity-50" onClick={search} disabled={busy}>
      <Icon name="refresh" size={14}/>{busy ? 'A procurar…' : 'Recuperar vínculo automático'}
    </button>}

    {candidates !== null && candidates.length > 0 && <div className="grid gap-2">
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-whx-soft">Conversas encontradas:</p>
      <ul className="m-0 grid max-h-40 list-none gap-1.5 overflow-y-auto p-0">
        {candidates.map((candidate) => <li key={candidate.chatgpt_url} className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 ${candidate.conflict ? 'border-whx-border-soft bg-whx-muted opacity-60' : 'border-whx-border-soft bg-whx-bg hover:border-whx-accent/40'}`}>
          <div className="min-w-0 flex-1"><code className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-whx-soft">{candidate.chatgpt_url}</code><span className="mt-0.5 block text-xs text-whx-faint">{EVIDENCE_LABEL[candidate.evidence] || 'origem desconhecida'}</span></div>
          {candidate.conflict
            ? <span className="shrink-0 text-xs font-semibold text-whx-warning">Já vinculado a outro chat</span>
            : <button type="button" className="min-h-8 shrink-0 rounded-md border border-whx-accent/50 bg-whx-accent-soft px-2.5 text-xs font-semibold hover:bg-whx-hover" onClick={() => void bind(candidate.chatgpt_url)}>Vincular</button>}
        </li>)}
      </ul>
    </div>}

    {candidates !== null && candidates.length === 0 && <p className="m-0 rounded-lg border border-dashed border-whx-border bg-whx-bg px-2.5 py-2 text-sm leading-5 text-whx-faint">Nenhuma conversa encontrada nos registos. Abra a conversa do ChatGPT e cole o endereço.</p>}

    {!linkedUrl && <div className="grid gap-2">
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-whx-soft">Ou cole manualmente:</p>
      <label className="flex items-stretch gap-1.5">
        <input type="url" value={manual} placeholder="https://chatgpt.com/c/…" onChange={(event) => setManual(event.target.value)} aria-label="Endereço da conversa do ChatGPT" className="min-w-0 flex-1 rounded-lg border border-whx-border bg-whx-bg px-2.5 text-sm text-whx-soft outline-none placeholder:text-whx-faint focus:border-whx-accent focus:bg-whx-surface"/>
        <button type="button" className="min-h-9 shrink-0 rounded-lg border border-whx-accent/50 bg-whx-accent-soft px-3 text-sm font-semibold transition hover:bg-whx-hover disabled:cursor-default disabled:opacity-50" disabled={!manual.trim()} onClick={() => void bind(manual.trim())}>Vincular este endereço</button>
      </label>
    </div>}

    {error && <p className="m-0 flex items-start gap-2 rounded-lg border border-whx-danger/40 bg-whx-danger/10 px-2.5 py-2 text-sm leading-5 text-whx-danger"><span className="mt-0.5 shrink-0"><Icon name="alert" size={14}/></span>{error}</p>}
  </section>
}
