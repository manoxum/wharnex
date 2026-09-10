import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('attention polling stays bounded with many chats', () => {
  // Each Session payload is 1-2 MB (context manifest, pending patches, artifact
  // inventory). Fetching one per chat meant a workspace with thirty chats
  // pulled and parsed tens of megabytes on every poll, which blocked the
  // renderer's main thread until the window was killed and restarted in a loop.
  it('uses one compact request for the whole project', () => {
    expect(source).toMatch(/await api\.workspaceAttention\(session\.project_path\)/)
    const start = source.indexOf('const refresh = async () => {')
    const end = source.indexOf('const timer = window.setInterval', start)
    const body = source.slice(start, end)
    expect(body).not.toMatch(/api\.getSession/)
    expect(body).not.toMatch(/Promise\.all\(chats\.map/)
  })

  it('does not poll on a six-second timer', () => {
    expect(source).toMatch(/const ATTENTION_REFRESH_INTERVAL_MS = 15_000/)
    expect(source).toMatch(/window\.setInterval\(\(\) => void refresh\(\), ATTENTION_REFRESH_INTERVAL_MS\)/)
  })

  // The active chat's own session is the live one the workspace renders, so it
  // is used directly rather than reconstructed from a projection.
  it('keeps the active session intact', () => {
    expect(source).toMatch(/if \(chat\.id === activeChatId && chat\.sessionId === session\.id\) return \[chat\.id, session\] as const/)
  })

  it('adapts the compact record without carrying a context manifest', () => {
    expect(source).toMatch(/function attentionSessionFrom\(record: AttentionRecord, projectPath: string\): Session/)
    const start = source.indexOf('function attentionSessionFrom(')
    const body = source.slice(start, start + 1600)
    expect(body).toMatch(/files: \[\]/)
    // The two collections are read for their length alone.
    expect(body).toMatch(/Array\.from\(\{ length: record\.pending_host_changes \}\)/)
  })
})
