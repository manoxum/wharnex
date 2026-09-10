import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App chat-id backfill', () => {
  it('backfills a legacy session missing chat_id instead of leaving it permanently stuck on "system"-scoped bundle names', () => {
    // A session created before chat-id propagation existed (or whose
    // creation call failed to attach one) has an empty chat_id forever,
    // which makes every derived-request bundle filename fall back to a
    // "system" placeholder that can never match this chat's real id —
    // deterministically failing bundle validation for that session on
    // every subsequent repair round. The effect must call api.setChatId
    // as soon as it notices session.chat_id !== activeChatId, and must be
    // deduplicated per session id so it does not refire every render.
    const start = source.indexOf('chatIdBackfillRef.current.has(session.id)')
    expect(start).toBeGreaterThan(-1)
    const window = source.slice(start - 900, start + 400)
    expect(window).toContain('session.chat_id === activeChatId) return')
    expect(window).toContain('api.setChatId(session.id, activeChatId)')
  })

  // A chat switch changes the active chat id immediately and reconciles the
  // session behind it, so `session` is briefly still the previous chat's. That
  // transient must not be reported as an inconsistent association — doing so
  // fired the error on essentially every switch.
  it('ignores the stale session a switch leaves behind instead of calling it inconsistent', () => {
    const start = source.indexOf('Associação de chat inconsistente')
    expect(start).toBeGreaterThan(-1)
    const window = source.slice(start - 700, start)
    expect(window).toContain('const owner = chats.find((chat) => chat.id === activeChatId)')
    expect(window).toContain('if (owner && owner.sessionId !== session.id) return')
  })
})
