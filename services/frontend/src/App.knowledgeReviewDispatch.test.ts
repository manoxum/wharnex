import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const changeSummarySource = readFileSync(resolve(process.cwd(), 'src/lib/changeSummary.ts'), 'utf8')

describe('App knowledge-review dispatch', () => {
  it('dispatches the post-apply knowledge review prompt keyed on its own field, never on session.state', () => {
    // The knowledge_review round is intentionally independent of
    // session.state (the apply that triggered it already succeeded and
    // state already reflects that) — this effect must key off
    // pending_knowledge_review_request_id alone, with its own dedup
    // namespace, and must not fold into the repair/conflict/baseline
    // dispatch effect above it (which explicitly keys off session.state).
    const start = source.indexOf('session.pending_knowledge_review_request_id')
    expect(start).toBeGreaterThan(-1)
    const effectStart = source.lastIndexOf('useEffect(() => {', start)
    const effectEnd = source.indexOf('}, [session, activeChatOwnsSession, activeChatId, chats])', start)
    const body = source.slice(effectStart, effectEnd)
    expect(body).toContain("session.pending_knowledge_review_request_id")
    expect(body).toContain('!isAutomaticAutomationMode(session.automation_mode)')
    expect(body).toContain('transportPlannerContinuation(session, targetChat)')
    expect(body).toContain('knowledge:${targetChat.id}:${session.pending_knowledge_review_request_id}')
    // The comment above may mention session.state in prose (explaining why
    // it's avoided); the actual condition/logic must never branch on it.
    expect(body).not.toMatch(/if \([^)]*session\.state/)
    expect(body).not.toContain("session.state ===")
    expect(body).not.toContain('includes(session.state)')
  })

  it('uses the one authoritative pending request identity when transporting a continuation', () => {
    const start = source.indexOf('async function transportPlannerContinuation')
    const end = source.indexOf('async function submitConflictPrompt', start)
    const body = source.slice(start, end)
    expect(body).toContain('const continuationRequestId = activePendingRequestId(promptSession)')
    expect(body).toContain('requestId: continuationRequestId')
    expect(body).not.toContain("requestId: promptSession.last_request_id || ''")
  })

  it('defers applied diff/host-command presentation until the knowledge review bundle is ingested', () => {
    expect(source).toContain('const knowledgeReviewResult = targetSession.pending_knowledge_review_request_id === requestId')
    expect(source).toContain('const waitingForKnowledgeReview = submission.auto_applied && Boolean(updated.pending_knowledge_review_request_id)')
    expect(source).toContain('await transportPlannerContinuation(updated, targetChat)')
    const reviewIndex = source.indexOf('const appliedTerminalPackage = knowledgeReviewResult || (submission.auto_applied && !waitingForKnowledgeReview)')
    expect(reviewIndex).toBeGreaterThan(-1)
    const terminalPackage = source.slice(reviewIndex, reviewIndex + 1_500)
    expect(terminalPackage).toContain('else if (appliedTerminalPackage)')
    expect(terminalPackage).toContain('presentAppliedSession(targetChat, updated)')
    expect(terminalPackage).not.toContain('appendChatItem(targetChat, updated.project_path, bundleItem)')
    expect(changeSummarySource).toContain('Alterações e comandos aplicados ao host.')
    expect(source).toContain('restartModalOpen && restartReports.length > 0 && <RestartConfirmation reports={restartReports}')
    expect(source).toContain('change: buildAppliedChangeSummary(candidate)')
  })
})
