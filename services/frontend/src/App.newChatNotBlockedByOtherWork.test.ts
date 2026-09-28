import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App new-chat creation', () => {
  it('does not gate newChat on the shared busy flag used by unrelated in-flight work in other chats', () => {
    // `busy` is shared across many unrelated operations (send, apply, retry,
    // reprocess...) that can be in flight for a DIFFERENT chat. Each chat
    // owns an independent backend session, so creating a new one has no
    // actual conflict with another chat's in-flight request — gating on the
    // shared flag made "Novo chat" silently do nothing while unrelated work
    // elsewhere was merely processing. Only a dedicated ref may debounce a
    // genuine double-click of this same action.
    const start = source.indexOf("async function newChat(initialMessage = '')")
    const end = source.indexOf('\n  async function exportActiveChat')
    const body = source.slice(start, end)
    expect(body).not.toMatch(/if \(!session \|\| busy\)/)
    expect(body).toContain('creatingChatRef.current')
    expect(body).toContain('api.createSession(')
    expect(body).toContain("saveComposerDraft(created.project_path, chat.id, { message: initialMessage.trim(), height: 156 })")
  })
})
