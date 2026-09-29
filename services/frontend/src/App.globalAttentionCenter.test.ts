import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const routingSource = readFileSync(resolve(process.cwd(), 'src/lib/useAttentionNavigation.ts'), 'utf8')

describe('App global attention session refresh', () => {
  it('refreshes inactive chat sessions on a bounded cadence and feeds the Agent center', () => {
    expect(source).toMatch(/setAttentionSessions/)
    // Sequential, on a bounded interval: fetching every chat's session at once
    // every six seconds grew the renderer until it was killed once a workspace
    // held many chats (see App.attentionMemory.test.ts).
    expect(source).toMatch(/await api\.workspaceAttention\(session\.project_path\)/)
    expect(source).toContain('setOrchestratorConclusionState({ projectPath: session.project_path, items: snapshot.orchestratorConclusions })')
    expect(source).toMatch(/window\.setInterval\(\(\) => void refresh\(\), ATTENTION_REFRESH_INTERVAL_MS\)/)
    // The shell collects the attention list, because the top-chrome preview
    // and the full side drawer are two views of one project-wide list.
    expect(source).toMatch(/collectAttentionItems\(chats, attentionSessions, chatgptHumanActions\)/)
    expect(source).toContain('orchestratorConclusionAttentionItems(orchestratorConclusions)')
    expect(source).toContain('const allAttentionItems = mergeAttentionItems(')
    expect(source).toMatch(/attentionItems=\{attentionItems\}/)
  })

  it('publishes only post-baseline completion notifications while keeping restart notifications unchanged', () => {
    expect(source).toContain('nativeNotificationIdsRef.current.has(entry.id)')
    expect(source).toContain('nativeNotificationIdsRef.current.add(entry.id)')
    expect(source).toContain('shouldPublishNativeAttentionAfterBaseline(entry, nativeCompletionBaselineRef.current)')
    expect(source).toContain("collectAttentionItems(orchestratorRestart.chats, orchestratorRestart.sessions).filter((item) => item.kind === 'restart-pending')")
  })

  it('acknowledges clicked task completions and keeps them outside the active alert count', () => {
    expect(source).toMatch(/filterActiveAttentionItems\(allAttentionItems, attentionHistory\)/)
    expect(source).toContain("if (item.kind !== 'task-completed' || !session) return")
    expect(source).toContain('acknowledgeCompletedAttention(session.project_path, item, history)')
    expect(source).toContain('attentionHistoryItems={attentionHistory}')
  })

  it('routes Orchestrator conclusions to their task without treating the synthetic execution id as a chat', () => {
    expect(source).toContain('useAttentionNavigation({')
    expect(source).toContain('focusTaskId={orchestratorTaskFocus.projectPath === session.project_path ? orchestratorTaskFocus.taskId : undefined}')
    expect(routingSource).toContain("if (item.kind === 'task-completed' && item.orchestratorTaskId)")
    expect(routingSource).toContain('openOrchestratorTask(item.orchestratorTaskId)')
    expect(routingSource).toContain("setMode('orchestrator')")
    expect(routingSource).toContain('openOrchestratorTask(completed.orchestratorTaskId)')
    expect(routingSource).toContain('acknowledge(completed)')
    expect(routingSource).toContain("setMode('agent')")
    expect(routingSource).toContain('chats.some((chat) => chat.id === item.chatId)')
    expect(source).toContain('attentionSessions, orchestratorConclusionState])')
    expect(routingSource).toContain("if (item.kind === 'restart-pending') {")
    expect(routingSource).toContain("if (notice.kind === 'restart-pending') await openRestart(notice.chatId)")
  })


  it('routes the top-chrome bell through the compact preview before the full drawer', () => {
    expect(source).toContain("const [attentionPreviewOpen, setAttentionPreviewOpen] = useState(false)")
    expect(source).toContain("if (event.data?.type === 'wharness:open-attention') setAttentionPreviewOpen((open) => !open)")
    expect(source).toContain("onAttention={() => setAttentionPreviewOpen((open) => !open)}")
    expect(source).toContain("onOpenAll={() => { setAttentionPreviewOpen(false); setMode('agent'); openLeftDrawer('attention') }}")
    expect(source).not.toContain("if (event.data?.type === 'wharness:open-attention') { setMode('agent'); window.dispatchEvent(new CustomEvent('wharnex:open-attention-drawer')) }")
  })

  it('never assigns an unrelated chat human-action notice to the active chat', () => {
    expect(source).toContain('chatgptHumanActions[activeChatId]')
    expect(source).not.toContain('activeConflictKey')
    expect(source).not.toContain('chatgptHumanActions[activeChatId] || Object.values(chatgptHumanActions)[0]')
  })

  it('keeps a chat bound to the replacement session created after a stale alert target', () => {
    expect(source).toMatch(/const next = availableChats\.map\(\(chat\) => chat\.id === chatId \? \{ \.\.\.chat, sessionId: restored\.id \} : chat\)\s+persistChats\(restored\.project_path, next\)\s+setChats\(next\)/)
  })
})
