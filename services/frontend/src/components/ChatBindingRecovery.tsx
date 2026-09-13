import { useCallback, useState } from 'react'
import { api } from '../lib/api'
import type { WorkspaceChatBindingCandidate } from '../types'

// Shown when a chat has no conversation binding. A chat in that state opens the
// ChatGPT home surface as if it had never been bound, and until now the only
// way back was for the operator to remember which conversation it was.
//
// Recovery proposes; it never rebinds on its own. Pointing a chat at the wrong
// conversation would send its next request into somebody else's thread, so the
// operator confirms — which is also what makes this an explicit rebind under
// the affinity invariant rather than silent navigation.

const EVIDENCE_LABEL: Record<WorkspaceChatBindingCandidate['evidence'], string> = {
  agent_queue: 'fila de agentes deste chat',
  transcript: 'transcrição deste chat',
  session_events: 'histórico da sessão',
}

export function ChatBindingRecovery({ chatId, onBind }: {
  chatId: string
  onBind: (url: string) => boolean
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
    // The renderer binding is the fast path; persisting it through the explicit
    // remote endpoint is what makes it survive a reload.
    try { await api.updateWorkspaceChatRemote(chatId, { chatgpt_url: url }) } catch { /* the renderer binding still applies */ }
  }, [chatId, onBind])

  return (
    <div className="chat-binding-recovery">
      <p className="chat-binding-recovery-summary">
        Este chat não está vinculado a nenhuma conversa do ChatGPT, por isso abre a página inicial.
      </p>
      <button type="button" onClick={search} disabled={busy}>
        {busy ? 'A procurar…' : 'Recuperar vínculo'}
      </button>
      {candidates !== null && candidates.length === 0 && (
        <p className="chat-binding-recovery-empty">
          Nenhuma conversa encontrada nos registos deste chat. Abra a conversa no ChatGPT e cole o endereço abaixo.
        </p>
      )}
      {candidates !== null && candidates.length > 0 && (
        <ul className="chat-binding-recovery-candidates">
          {candidates.map((candidate) => (
            <li key={candidate.chatgpt_url}>
              <code>{candidate.chatgpt_url}</code>
              <span className="chat-binding-recovery-evidence">
                Encontrado na {EVIDENCE_LABEL[candidate.evidence] || 'origem desconhecida'}
              </span>
              {candidate.conflict
                ? <span className="chat-binding-recovery-conflict">Já pertence a outro chat</span>
                : <button type="button" onClick={() => void bind(candidate.chatgpt_url)}>Vincular</button>}
            </li>
          ))}
        </ul>
      )}
      <label className="chat-binding-recovery-manual">
        <span>Ou cole o endereço da conversa</span>
        <input
          type="url"
          value={manual}
          placeholder="https://chatgpt.com/c/…"
          onChange={(event) => setManual(event.target.value)}
        />
      </label>
      <button type="button" disabled={!manual.trim()} onClick={() => void bind(manual.trim())}>
        Vincular este endereço
      </button>
      {error && <p className="chat-binding-recovery-error">{error}</p>}
    </div>
  )
}
