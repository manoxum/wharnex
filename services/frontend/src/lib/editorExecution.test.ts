import { beforeEach, describe, expect, it } from 'vitest'
import type { FileEntry } from '../types'
import { editorExecutableOptions, loadEditorRunHistory, recentEditorRunOptions, rememberEditorRun } from './editorExecution'

const packageFiles = [
  { path: 'apps/web/package.json', kind: 'file', size: 120 },
  { path: 'apps/web/pnpm-lock.yaml', kind: 'file', size: 20 },
] as FileEntry[]

describe('editor execution affordances', () => {
  beforeEach(() => localStorage.clear())

  it('maps package scripts to their editor lines and respects the local package manager', () => {
    const source = `{
  "name": "web",
  "scripts": {
    "dev": "vite",
    "test:unit": "vitest --run"
  }
}`
    const options = editorExecutableOptions('apps/web/package.json', source, packageFiles)
    expect(options.map((option) => ({ label: option.label, command: option.command, cwd: option.cwd, line: option.line }))).toEqual([
      { label: 'Script · dev', command: "pnpm run 'dev'", cwd: 'apps/web', line: 4 },
      { label: 'Script · test:unit', command: "pnpm run 'test:unit'", cwd: 'apps/web', line: 5 },
    ])
  })

  it('shows only commands that have already been run and orders them by recency', () => {
    const source = '{\n  "scripts": {\n    "dev": "vite",\n    "test": "vitest"\n  }\n}'
    const options = editorExecutableOptions('package.json', source, [])
    expect(recentEditorRunOptions(options, loadEditorRunHistory('/work/demo'))).toEqual([])

    rememberEditorRun('/work/demo', options[1])
    rememberEditorRun('/work/demo', options[0])
    const history = loadEditorRunHistory('/work/demo')
    expect(recentEditorRunOptions(options, history).map((option) => option.label)).toEqual(['Script · dev', 'Script · test'])
  })

  it('deduplicates repeated executions while preserving the newest label', () => {
    rememberEditorRun('/work/demo', { command: "npm run 'dev'", cwd: '.', label: 'Primeiro' })
    rememberEditorRun('/work/demo', { command: "npm run 'dev'", cwd: '.', label: 'Dev' })
    expect(loadEditorRunHistory('/work/demo')).toEqual([{ command: "npm run 'dev'", cwd: '.', label: 'Dev' }])
  })
})
