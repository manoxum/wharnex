import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App ChatGPT affinity ownership', () => {
  it('persists definitive binding candidates even when the ChatGPT inspector pane is not mounted', () => {
    expect(source).toMatch(/return bridge\.chatgpt\.onState\(\(next\) =>/)
    expect(source).toMatch(/const ownerKey = String\(next\?\.cacheKey/)
    expect(source).toMatch(/const candidate = chatgptConversationURL\(next\?\.bindingCandidate/)
    expect(source).toMatch(/bindChatGPTURLForChat\(ownerKey, session\.project_path, candidate\)/)
  })

  it('confirms the same conversation idempotently instead of depending on pane visibility', () => {
    expect(source).toMatch(/if \(!sameChatGPTConversation\(target\.chatgptUrl, conversation\)\)/)
    expect(source).toMatch(/desktopBridge\(\)\?\.chatgpt\.confirmAffinity\(chatId, conversation\)/)
  })
})
