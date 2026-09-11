import { describe, expect, it } from 'vitest'
import source from './App.tsx?raw'
import apiSource from './lib/api.ts?raw'
import railSource from './components/WorkspaceSideRail.tsx?raw'
import recoverySource from './components/InterruptedExecutionRecovery.tsx?raw'

describe('interrupted execution recovery', () => {
  it('keeps interrupted execution recovery explicit without globally blocking the workspace', () => {
    expect(source).toMatch(/interruptedExecutions/)
    expect(source).toMatch(/<InterruptedExecutionRecovery/)
    expect(recoverySource).toMatch(/Nenhuma execução é retomada sem a sua decisão/)
    expect(recoverySource).toMatch(/type RecoveryDecision = 'continue' \| 'discard'/)
    expect(source).toMatch(/api\.resumeInterruptedExecution\(target\.session\.id\)/)
    expect(source).toMatch(/api\.discardInterruptedExecution\(target\.session\.id\)/)
    expect(source).toMatch(/const recoveryBlocksActiveChat = interruptedExecutions\.some/)
    expect(source).toMatch(/const taskInFlight = requestChainActive\(session\) \|\| restartModalOpen \|\| recoveryBlocksActiveChat/)
    expect(source).not.toMatch(/taskInFlight =[^\n]*interruptedExecutions\.length/)
    expect(source).not.toMatch(/chatgptSuspended:[^\n]*interruptedExecutions/)
    expect(recoverySource).not.toMatch(/aria-modal=/)
    expect(recoverySource).not.toMatch(/restart-confirmation-backdrop/)
    expect(apiSource).toMatch(/interrupted-execution\/resume/)
    expect(apiSource).toMatch(/interrupted-execution\/discard/)
  })

  it('projects the authoritative project FIFO in the frontend', () => {
    expect(source).toMatch(/executionFIFO/)
    expect(source).toMatch(/execution\.queued/)
    expect(source).toMatch(/execution\.dequeued/)
    expect(source).toMatch(/executionFIFO=\{visibleExecutionFIFO\}/)
    // The FIFO drawer lives in the shared side rail, beside every mode.
    expect(railSource).toMatch(/Fila FIFO de execução/)
  })

  it('routes evidence analysis through a dedicated self-evolution chat', () => {
    expect(source).toMatch(/chat\.purpose === 'self-evolution'/)
    expect(source).toMatch(/purpose: 'self-evolution'/)
    expect(source).toMatch(/analyzeEvolutionEvidence\(targetSession\.id, evidenceIds\)/)
    expect(source).toMatch(/setActiveChatId\(targetChat\.id\)/)
  })
})
