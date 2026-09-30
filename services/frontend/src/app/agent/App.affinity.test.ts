import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = [readFileSync(resolve(process.cwd(), 'src/app/workspace/App.tsx'), 'utf8'), readFileSync(resolve(process.cwd(), 'src/app/chat/catalogActions.ts'), 'utf8'), readFileSync(resolve(process.cwd(), 'src/app/chat/activeChatLifecycleActions.ts'), 'utf8')].join('\n')

describe('App ChatGPT affinity ownership', () => {
  it('persists definitive binding candidates even when the ChatGPT inspector pane is not mounted', () => {
    expect(source).toMatch(/return bridge\.chatgpt\.onState\(\(next\) =>/)
    expect(source).toMatch(/const ownerKey = String\(next\?\.cacheKey/)
    expect(source).toMatch(/const candidate = chatgptConversationURL\(next\?\.bindingCandidate/)
	expect(source).toMatch(/bindChatGPTURLForOwnedKey\(ownerKey, session\.project_path, candidate\)/)
  })

  it('confirms the same conversation idempotently instead of depending on pane visibility', () => {
	expect(source).toMatch(/if \(target\.chatgptUrl && !sameChatGPTConversation\(target\.chatgptUrl, conversation\)\)/)
	expect(source).toMatch(/chatgpt\.rejectAffinity\(chatId, conversation\)/)
    expect(source).toMatch(/if \(!sameChatGPTConversation\(target\.chatgptUrl, conversation\)\)/)
    expect(source).toMatch(/desktopBridge\(\)\?\.chatgpt\.confirmAffinity\(chatId, conversation\)/)
  })

  it('reconciles missed background candidates for every chat after a chat switch', () => {
	expect(source).toMatch(/const keys = chats\.map\(\(chat\) => chat\.id\)/)
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
    expect(source).toMatch(/cacheKey, sessionId: candidate\.id, requestId, url, recoveryBootstrap/)
    expect(source).toMatch(/chatTitle: chat\.title, chatHash: sessionContextSHA\(candidate\)/)
  })

  it('owns bundle imports at workspace level so inactive chats continue automatically', () => {
    expect(source).toMatch(/bridge\.chatgpt\.onBundleDownloaded\(\(bundle\) =>/)
    expect(source).toMatch(/submitBundleFileRef\.current\(bundle\.contentBase64, bundle\.requestId, bundle\.filename\)/)
  })

  it('restores the immutable affinity before sending from a mismatched view', () => {
	expect(source).toMatch(/restoreChatGPTConversationAffinity\(targetChat\)/)
	expect(source).not.toMatch(/Autorizar nova vinculação ChatGPT/)
  })

  it('keeps remote account lifecycle operations on the durable worker queue', () => {
    expect(source).toMatch(/firstRequest, chatTitle: generatedChatTitle, requestedAt: userItem\.createdAt, projectName: chatGPTProjectName\(projectPath\)/)
    expect(source).toMatch(/bridge\.chatgpt\.queueArchive\(\{ cacheKey: chatId/)
    expect(source).toMatch(/chatgpt\.queueRename\(\{ cacheKey: target\.id/)
    expect(source).toMatch(/chatgpt\.queueDelete\(\{ cacheKey: chatId/)
    expect(source).not.toMatch(/chatgpt\.archiveConversation\(/)
    expect(source).not.toMatch(/chatgpt\.organizeConversation\(/)
  })

  it('promotes the planner bundle title and queues the remote rename once', () => {
    expect(source).toMatch(/const resultTitle = plannerChatTitle\(updated\.last_turn\?\.chat_title\)/)
    expect(source).toMatch(/resultTitle && targetChat\.naming\?\.state !== 'definitive'/)
    expect(source).toMatch(/chatgpt\.queueRename\(\{[\s\S]*title: resultTitle/)
    expect(source).toMatch(/state: 'provisional', attempts: targetChat\.naming\?\.attempts \|\| 0/)
  })

  // Closing a chat is a local decision: enqueue failure may be recorded, but
  // it cannot hold the local chat open or resurrect the visible Supervisor.
  it('archives locally before awaiting the remote worker queue', () => {
    const archiveStart = source.indexOf('async function archiveChat(chatId: string)')
    const archiveEnd = source.indexOf('async function restoreArchivedChat', archiveStart)
    const archive = source.slice(archiveStart, archiveEnd)
    expect(archive).toMatch(/const moved = archiveStoredChat\(projectPath, chatId, remoteArchive\)/)
    expect(archive).toMatch(/await bridge\.chatgpt\.queueArchive/)
    expect(archive.indexOf('archiveStoredChat')).toBeLessThan(archive.indexOf('queueArchive'))
  })
})
