import { useState } from 'react'
import type { ConflictWorkbench, GitConflictStrategy, Session } from '../../../types'
import { api } from '../../transport/http/api'

type ConflictReview = { session: Session; workbench: ConflictWorkbench; strategy: GitConflictStrategy; autoGPT: boolean }

type Params = {
  session: Session
  strategy?: GitConflictStrategy
  onSession?: (session: Session) => void
  onResolveConflictWithGPT?: (session: Session) => Promise<void>
  onOpenGitConflictChat?: (session: Session) => Promise<void>
  report: (error: unknown) => void
}

export function useGitConflictReview({ session, strategy = 'user_decide', onSession, onResolveConflictWithGPT, onOpenGitConflictChat, report }: Params) {
  const [conflictReview, setConflictReview] = useState<ConflictReview | null>(null)

  async function conflictMessage(conflictID: string | undefined, context: string) {
    if (!conflictID) return context
    const [workbench, updated] = await Promise.all([api.conflictWorkbench(session.id), api.getSession(session.id)])
    onSession?.(updated)
    setConflictReview({ session: updated, workbench, strategy, autoGPT: strategy === 'gpt_only' })
    if (strategy === 'gpt_only') return `${context} Reveja o conflito em três vias; ao fechar, a resolução seguirá automaticamente para o GPT.`
    if (strategy === 'user_only') return `${context} A resolução manual foi aberta com as versões Atual, Resultado e Recebido.`
    return `${context} A resolução em três vias foi aberta; pode resolver manualmente ou delegar o restante ao GPT.`
  }

  async function closeConflictReview() {
    const review = conflictReview
    setConflictReview(null)
    if (!review?.autoGPT) return
    try {
      if (onOpenGitConflictChat) await onOpenGitConflictChat(review.session)
      else {
        const updated = await api.delegateConflictToGPT(review.session.id, [], '')
        onSession?.(updated)
        await onResolveConflictWithGPT?.(updated)
      }
    } catch (error) { report(error) }
  }

  return { conflictReview, conflictMessage, closeConflictReview }
}
