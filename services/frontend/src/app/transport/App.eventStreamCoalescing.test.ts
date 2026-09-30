import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/app/execution/useEventStreamConnection.ts'), 'utf8')

// The coalescer itself is covered by lib/eventStream.test.ts. What this guards
// is the wiring: the crash came from App handling every SSE frame on its own
// and persisting the retained window from inside a React state updater, which
// React may replay for every queued update on every render pass.
describe('App event stream wiring', () => {
  const start = source.indexOf('return useCallback(')
  const connect = source.slice(start, source.indexOf('\n}', start))

  it('routes every frame through the coalescer instead of updating per frame', () => {
    expect(start).toBeGreaterThan(-1)
    expect(connect).toContain('createEventStreamCoalescer(')
    expect(connect).toContain('coalescer.accept(JSON.parse(event.data) as HarnessEvent)')
  })

  it('never persists the event window from inside a state updater', () => {
    const updaterPersist = /set[A-Za-z]+\(\s*\([^)]*\)\s*=>[\s\S]{0,400}?saveExecutionHistory\(/.test(connect)
    expect(updaterPersist).toBe(false)
    expect(connect).toContain('onPersist: (eventWindow) => saveExecutionHistory(projectPath, chatId, eventWindow)')
  })

  it('reads the workspace chats once per batch rather than once per frame', () => {
    expect(connect.match(/loadWorkspaceChats\(projectPath\)/g)).toHaveLength(1)
  })

  it('disposes the previous stream so a stale timer cannot write another chat', () => {
    expect(connect).toContain('coalescerRef.current?.dispose()')
    expect(connect).toContain('isCurrent: () => sourceRef.current === source')
  })

  it('refreshes the session as soon as an input bundle artifact is persisted', () => {
    expect(connect).toContain("parsed.type === 'artifact.persisted' && parsed.data.kind === 'bundle'")
    expect(connect).toContain('void api.getSession(id).then((updated) => {')
    expect(connect).toContain('sessionCacheRef.current[chatId] = updated')
  })
})
