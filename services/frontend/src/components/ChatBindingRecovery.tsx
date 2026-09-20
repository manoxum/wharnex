import { useCallback, useState } from 'react'
import { api } from '../lib/api'
import type { WorkspaceChatBindingCandidate } from '../types'
import { Icon } from './Icon'

// Shown when a chat has no conversation binding. A chat in that state opens the
// ChatGPT home surface as if it had never been bound, and until now the only
// way back was for the operator to remember which conversation it was.
//
// Recovery proposes; it can establish only the missing first binding. Pointing
// a chat at the wrong conversation would send its next request into somebody
// else's thread, so the operator confirms the candidate.

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
      <div className="chat-binding-recovery-header">
        <Icon name="link" size={18} />
        <div className="chat-binding-recovery-header-text">
          <strong>Este chat perdeu sua conversa</strong>
          <span>Recupere o vínculo com a conversa do ChatGPT</span>
        </div>
      </div>
      <div className="chat-binding-recovery-actions">
        <button type="button" className="chat-binding-recovery-primary" onClick={search} disabled={busy}>
          <Icon name="refresh" size={14} />
          {busy ? 'A procurar…' : 'Recuperar vínculo automático'}
        </button>
      </div>
      {candidates !== null && candidates.length > 0 && (
        <div className="chat-binding-recovery-candidates-section">
          <p className="chat-binding-recovery-label">Conversas encontradas:</p>
          <ul className="chat-binding-recovery-candidates">
            {candidates.map((candidate) => (
              <li key={candidate.chatgpt_url} className={candidate.conflict ? 'conflict' : ''}>
                <div className="chat-binding-recovery-candidate-info">
                  <code>{candidate.chatgpt_url}</code>
                  <span className="chat-binding-recovery-evidence">
                    {EVIDENCE_LABEL[candidate.evidence] || 'origem desconhecida'}
                  </span>
                </div>
                {candidate.conflict
                  ? <span className="chat-binding-recovery-conflict">Já vinculado a outro chat</span>
                  : <button type="button" className="chat-binding-recovery-candidate-bind" onClick={() => void bind(candidate.chatgpt_url)}>Vincular</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {candidates !== null && candidates.length === 0 && (
        <p className="chat-binding-recovery-empty">
          Nenhuma conversa encontrada nos registos. Abra a conversa do ChatGPT e cole o endereço.
        </p>
      )}
      <div className="chat-binding-recovery-manual-section">
        <p className="chat-binding-recovery-label">Ou cole manualmente:</p>
        <label className="chat-binding-recovery-manual">
          <input
            type="url"
            value={manual}
            placeholder="https://chatgpt.com/c/…"
            onChange={(event) => setManual(event.target.value)}
            aria-label="Endereço da conversa do ChatGPT"
          />
          <button type="button" className="chat-binding-recovery-secondary" disabled={!manual.trim()} onClick={() => void bind(manual.trim())}>
            Vincular este endereço
          </button>
        </label>
      </div>
      {error && <p className="chat-binding-recovery-error"><Icon name="alert" size={14}/>{error}</p>}
    </div>
  )
}
