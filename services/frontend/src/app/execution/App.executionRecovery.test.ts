import { describe, expect, it } from 'vitest'
import appSource from '../workspace/App.tsx?raw'
import eventSource from './useEventStreamConnection.ts?raw'
const source = appSource + '\n' + eventSource
import apiSource from '../../lib/transport/http/api.ts?raw'
import railHostSource from '../../components/workspace/shell/WorkspaceSideRail.tsx?raw'
import railContentSource from '../../components/workspace/shell/panels/WorkspaceDrawerContent.tsx?raw'
const railSource = railHostSource + '\n' + railContentSource
import taskHostSource from '../../components/project/tasks/ProjectTasksDrawer.tsx?raw'
import taskQueueSource from '../../components/project/tasks/operations/ExecutionQueue.tsx?raw'
const taskSource = taskHostSource + '\n' + taskQueueSource
import recoverySource from '../../components/execution/recovery/InterruptedExecutionRecovery.tsx?raw'

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
    expect(source).toMatch(/executionFIFO: visibleExecutionFIFO/)
    expect(railSource).toMatch(/executionFIFO=\{executionFIFO\}/)
    expect(railSource).not.toMatch(/Fila FIFO de execução/)
    expect(taskSource).toMatch(/Execução FIFO/)
    expect(taskSource).toMatch(/projectTasks\(projectPath, \{ scope: 'active' \}\)/)
  })

  it('routes evidence analysis through a dedicated self-evolution chat', () => {
    expect(source).toMatch(/chat\.purpose === 'self-evolution'/)
    expect(source).toMatch(/purpose: 'self-evolution'/)
    expect(source).toMatch(/analyzeEvolutionEvidence\(targetSession\.id, evidenceIds, knowledgeRefs, artifactIds, knowledgeOnly\)/)
    expect(source).toMatch(/setActiveChatId\(targetChat\.id\)/)
  })
})
