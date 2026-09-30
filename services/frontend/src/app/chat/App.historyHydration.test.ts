import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = [readFileSync(resolve(process.cwd(), 'src/app/workspace/App.tsx'), 'utf8'), readFileSync(resolve(process.cwd(), 'src/app/chat/workspaceHydration.ts'), 'utf8')].join('\n')

describe('App durable transcript hydration', () => {
  it('hydrates backend history before the small local cache may be persisted', () => {
    const hydrateStart = source.indexOf('async function hydrateChatTranscript')
    const hydrateEnd = source.indexOf('\n  useEffect(() => {', hydrateStart)
    const hydrate = source.slice(hydrateStart, hydrateEnd)
    expect(hydrate).toContain('api.workspaceChatItems(chatId)')
    expect(hydrate).toContain('mergeDurableChatItems(local, durable)')
    expect(source).toContain('transcriptReadyRef.current.has(activeChatId)')
  })

  it('shows the cached tail immediately and merges the durable transcript after a chat switch', () => {
    const selectStart = source.indexOf('async function selectChat')
    const selectEnd = source.indexOf('function hideChatGPTSurfaces', selectStart)
    const select = source.slice(selectStart, selectEnd)
    expect(select).toContain('setItems(loadChat(projectPath, chatId))')
    expect(select).toContain('const transcriptPromise = hydrateChatTranscript(projectPath, chatId)')
    expect(select).toContain('mergeDurableChatItems(current, hydratedItems)')
  })
})
