import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App knowledge-review dispatch', () => {
  it('dispatches the post-apply knowledge review prompt keyed on its own field, never on session.state', () => {
    // The knowledge_review round is intentionally independent of
    // session.state (the apply that triggered it already succeeded and
    // state already reflects that) — this effect must key off
    // pending_knowledge_review_request_id alone, with its own dedup
    // namespace, and must not fold into the repair/conflict/baseline
    // dispatch effect above it (which explicitly keys off session.state).
    const start = source.indexOf('pending_knowledge_review_request_id')
    expect(start).toBeGreaterThan(-1)
    const effectStart = source.lastIndexOf('useEffect(() => {', start)
    const effectEnd = source.indexOf('}, [session, activeChatId, chats])', start)
    const body = source.slice(effectStart, effectEnd)
    expect(body).toContain("session.pending_knowledge_review_request_id")
    expect(body).toContain("session.automation_mode !== 'auto'")
    expect(body).toContain('transportPlannerContinuation(session, targetChat)')
    expect(body).toContain('knowledge:${targetChat.id}:${session.pending_knowledge_review_request_id}')
    // The comment above may mention session.state in prose (explaining why
    // it's avoided); the actual condition/logic must never branch on it.
    expect(body).not.toMatch(/if \([^)]*session\.state/)
    expect(body).not.toContain("session.state ===")
    expect(body).not.toContain('includes(session.state)')
  })

  it('defers applied diff/host-command presentation until the knowledge review bundle is ingested', () => {
    expect(source).toContain('const knowledgeReviewResult = targetSession.pending_knowledge_review_request_id === requestId')
    expect(source).toContain('const waitingForKnowledgeReview = submission.auto_applied && Boolean(updated.pending_knowledge_review_request_id)')
    expect(source).toContain('await transportPlannerContinuation(updated, targetChat)')
    const reviewIndex = source.indexOf('if (knowledgeReviewResult || (submission.auto_applied && !waitingForKnowledgeReview))')
    expect(reviewIndex).toBeGreaterThan(-1)
    expect(source.slice(reviewIndex, reviewIndex + 600)).toContain('buildAppliedChangeSummary(updated)')
    expect(source).toContain('Alterações e comandos aplicados ao host.')
    expect(source).toContain('restartModalOpen && restartPresentationKey && <RestartConfirmation')
    expect(source).toContain('change={buildAppliedChangeSummary(session)}')
  })
})