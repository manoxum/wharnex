import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App ChatGPT affinity ownership', () => {
  it('persists definitive binding candidates even when the ChatGPT inspector pane is not mounted', () => {
    expect(source).toMatch(/return bridge\.chatgpt\.onState\(\(next\) =>/)
    expect(source).toMatch(/const ownerKey = String\(next\?\.cacheKey/)
    expect(source).toMatch(/const candidate = chatgptConversationURL\(next\?\.bindingCandidate/)
	expect(source).toMatch(/bindChatGPTURLForOwnedKey\(ownerKey, session\.project_path, candidate\)/)
  })

  it('confirms the same conversation idempotently instead of depending on pane visibility', () => {
    expect(source).toMatch(/if \(!sameChatGPTConversation\(target\.chatgptUrl, conversation\)\)/)
    expect(source).toMatch(/desktopBridge\(\)\?\.chatgpt\.confirmAffinity\(chatId, conversation\)/)
  })

  it('reconciles missed background candidates for every chat after a chat switch', () => {
	expect(source).toMatch(/const keys = chats\.flatMap/)
	expect(source).toMatch(/Promise\.all\(keys\.map\(\(key\) => bridge\.chatgpt\.state\(key\)/)
    expect(source).toMatch(/const candidate = chatgptConversationURL\(state\?\.bindingCandidate/)
	expect(source).toMatch(/bindChatGPTURLForOwnedKey\(ownerKey, session\.project_path, candidate\)/)
	expect(source).toMatch(/\[bindChatGPTURLForOwnedKey, chats, recordChatGPTHumanAction, session\]/)
  })

  it('rehydrates pending bundle supervision for every chat independently of the active pane', () => {
    expect(source).toMatch(/Promise\.all\(chats\.map\(async \(chat\) =>/)
    expect(source).toMatch(/api\.getSession\(chat\.sessionId\)/)
    expect(source).toMatch(/pendingBundleRequestIDs\(candidate\)/)
    expect(source).toMatch(/bridge\.chatgpt\.resumeExpectedBundle\(\{/)
    expect(source).toMatch(/resumeExpectedBundle\(\{ cacheKey, requestId, url/)
  })

  it('owns bundle imports at workspace level so inactive chats continue automatically', () => {
    expect(source).toMatch(/bridge\.chatgpt\.onBundleDownloaded\(\(bundle\) =>/)
    expect(source).toMatch(/submitBundleFileRef\.current\(bundle\.contentBase64, bundle\.requestId, bundle\.filename\)/)
  })

  it('asks for explicit authorization before sending into a different remote conversation', () => {
    expect(source).toMatch(/authorizeChatGPTConversationMismatch\(targetChat\)/)
    expect(source).toMatch(/title: 'Autorizar nova vinculação ChatGPT\?'/)
  })

  it('organizes the first remote conversation and archives it before local removal', () => {
    expect(source).toMatch(/firstRequest, chatTitle: generatedChatTitle, projectName: chatGPTProjectName\(projectPath\)/)
    expect(source).toMatch(/bridge\.chatgpt\.archiveConversation\(chatId, target\.chatgptUrl\)/)
    expect(source).toMatch(/A conversa local não foi arquivada porque o arquivo remoto não pôde ser confirmado/)
  })
})
