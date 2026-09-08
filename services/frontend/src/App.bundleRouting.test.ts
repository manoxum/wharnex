import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App bundle routing', () => {
  it('classifies a bundle with no pending workspace owner as a non-terminal routing duplicate', () => {
    const routingCheck = source.indexOf('if (!targetSession || !targetChat)')
    expect(routingCheck).toBeGreaterThan(-1)
    expect(source.slice(routingCheck, routingCheck + 360)).toContain('throw new BundleRoutingError')

    const catchBranch = source.indexOf('if (isNonTerminalBundleRoutingError(e))')
    expect(catchBranch).toBeGreaterThan(-1)
    expect(source.slice(catchBranch, catchBranch + 260)).toContain('Bundle atrasado ou duplicado ignorado.')
  })

  it('retires a stale delivery banner as soon as its bundle reaches the owning chat', () => {
    const listener = source.indexOf('return bridge.chatgpt.onBundleDownloaded((bundle) =>')
    expect(listener).toBeGreaterThan(-1)
    const body = source.slice(listener, listener + 700)
    expect(body).toContain('delete next[bundle.cacheKey!]')

    const owner = source.indexOf('if (!targetSession || !targetChat)')
    const accepted = source.slice(owner, owner + 850)
    expect(accepted).toContain('delete next[targetChat!.id]')
  })

  it('removes an expired delivery action instead of leaving an infinite failing retry', () => {
    const missing = source.indexOf("detail.includes('Não existe uma entrega de prompt recente')")
    expect(missing).toBeGreaterThan(-1)
    expect(source.slice(missing, missing + 430)).toContain('delete next[activeChatId]')
  })

  it('does not treat last_request_id as pending after the session reached a terminal state', () => {
    const helper = source.indexOf('function sessionHasPendingRequest(session: Session, requestId: string)')
    expect(helper).toBeGreaterThan(-1)
    const body = source.slice(helper, helper + 430)
    expect(body).toContain("session.last_request_id !== requestId")
    expect(body).toContain("'awaiting_plan'")
    expect(body).not.toContain('|| session.last_request_id === requestId')
  })
})
