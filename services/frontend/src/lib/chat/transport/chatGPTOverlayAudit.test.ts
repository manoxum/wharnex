import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const audited = [
  ['../../../app/workspace/App.tsx', '<div className="chat-tab-context-menu workspace-surface-tab-menu"'],
  ['../../../components/agent/workspace/AgentWorkspace.tsx', '<div className="chat-overflow-menu"'],
  ['../../../components/agent/workspace/AgentWorkspace.tsx', '<div className="chat-tab-context-menu"'],
  ['../../../components/terminal/workspace/TerminalWorkspace.tsx', '<div className="terminal-overflow-menu"'],
  ['../../../components/agent/explorer/AgentProjectExplorer.tsx', '<div className="diff-inspector-backdrop"'],
  ['../../../components/orchestrator/tasks/OrchestratorTasks.tsx', '<div className="orchestrator-drawer-backdrop"'],
  ['../../../components/git/history/ProjectGitBadge.tsx', '<section className="project-git-menu"'],
  ['../../../components/git/history/ProjectGitBadge.tsx', '<div className="project-git-branch-menu"'],
  ['../../../components/git/history/ProjectGitBadge.tsx', '<div className="project-git-operation-layer"'],
  ['../../../components/editor/canvas/EditorWorkspace.tsx', '<details ref={runMenuRef} className="editor-run-menu"'],
] as const

function linesWithFragment(relativePath: string, fragment: string) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  return source.split('\n').filter((line) => line.includes(fragment))
}

describe('native ChatGPT overlay audit', () => {
  it.each(audited)('%s keeps its audited transient as an explicit trusted blocker', (relativePath, fragment) => {
    const lines = linesWithFragment(relativePath, fragment)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toContain('data-chatgpt-overlay-blocker="true"')
  })
})
