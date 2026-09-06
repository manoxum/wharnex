import { describe, expect, it } from 'vitest'
import source from './App.tsx?raw'
import apiSource from './lib/api.ts?raw'
import workspaceSource from './components/AgentWorkspace.tsx?raw'

describe('interrupted execution recovery', () => {
  it('requires an explicit per-task continue or discard decision after restart', () => {
    expect(source).toMatch(/interruptedExecutions/)
    expect(source).toMatch(/<InterruptedExecutionRecovery/)
    expect(source).toMatch(/Nenhuma será retomada sem a sua decisão/)
    expect(source).toMatch(/decision: 'continue' \| 'discard'/)
    expect(source).toMatch(/api\.execute\(target\.session\.id, intent\.approved\)/)
    expect(source).toMatch(/api\.discardInterruptedExecution\(target\.session\.id\)/)
    expect(apiSource).toMatch(/interrupted-execution\/discard/)
  })

  it('projects the authoritative project FIFO in the frontend', () => {
    expect(source).toMatch(/executionFIFO/)
    expect(source).toMatch(/execution\.queued/)
    expect(source).toMatch(/execution\.dequeued/)
    expect(source).toMatch(/executionFIFO=\{executionFIFO\}/)
    expect(workspaceSource).toMatch(/Fila FIFO de execução/)
  })
})
