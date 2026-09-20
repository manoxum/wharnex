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

  it('retires a stale delivery banner only after the backend acknowledges its bundle', () => {
    const listener = source.indexOf('const ingest = async (bundle: DesktopBundleDownload) =>')
    expect(listener).toBeGreaterThan(-1)
    const body = source.slice(listener, listener + 2200)
    const effect = source.slice(listener - 250, listener + 2400)
    const submit = body.indexOf('await submitBundleFileRef.current')
    const acknowledge = body.indexOf('await bridge.chatgpt.ackBundle')
    const clear = body.indexOf('delete next[bundle.cacheKey!]')
    expect(submit).toBeGreaterThan(-1)
    expect(acknowledge).toBeGreaterThan(submit)
    expect(clear).toBeGreaterThan(acknowledge)
    expect(body).toContain('await bridge.chatgpt.nackBundle')
    expect(body).toContain('bridge.chatgpt.pendingBundles()')
    expect(source).toContain('sessionOwnsRequest(targetSession, requestId)')
    expect(source).toContain('sessionOwnsRequest(candidate, requestId)')
    expect(effect).toContain("if (!isDesktop() || !bundleRoutingReadyKey) return")
    expect(effect).toContain('}, [bundleRoutingReadyKey])')
  })

  it('keeps workspace bundle routing active while Orchestrator or Editor owns the visible session', () => {
    const keyStart = source.indexOf('const bundleRoutingReadyKey =')
    expect(keyStart).toBeGreaterThan(-1)
    const keyDefinition = source.slice(keyStart, source.indexOf('\n', keyStart))
    expect(keyDefinition).toContain('session && chats.length > 0')
    expect(keyDefinition).not.toContain('activeChatOwnsSession && session')
  })

  it('falls back to durable request input and retires only an unrecoverable legacy retry', () => {
    const retry = source.indexOf('async function retryPreparedPromptDelivery')
    expect(retry).toBeGreaterThan(-1)
    const end = source.indexOf('\n  async function ', retry + 10)
    const body = source.slice(retry, end)
    expect(body).toContain('bridge.chatgpt.retryPreparedPrompt')
    const missing = body.indexOf("detail.includes('entrada completa deste pedido não está persistida')")
    expect(missing).toBeGreaterThan(-1)
    expect(body.slice(missing, missing + 500)).toContain('delete next[activeChatId]')
  })

  it('does not treat last_request_id as pending after the session reached a terminal state', () => {
    const helperSource = readFileSync(resolve(process.cwd(), 'src/lib/pendingRequest.ts'), 'utf8')
    const helper = helperSource.indexOf('export function sessionHasPendingRequest(session: Session, requestId: string)')
    expect(helper).toBeGreaterThan(-1)
    const body = helperSource.slice(helper, helper + 430)
    expect(helperSource).toContain("'awaiting_plan'")
    expect(body).toContain('pendingStates.has(session.state)')
  })

  it('rehydrates conflict supervision through the immutable owning conversation', () => {
    const recoveryStart = source.indexOf('const candidates = await Promise.all(chats.map(async (chat) =>')
    expect(recoveryStart).toBeGreaterThan(-1)
    const recovery = source.slice(recoveryStart, recoveryStart + 3200)
    expect(recovery).toContain('const url = chat.chatgptUrl')
    expect(recovery).toContain('const cacheKey = chat.id')
    expect(recovery).not.toContain('conflictSurfaces')
  })
})
