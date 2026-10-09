import { compose } from '../../context/context.mjs'
import { createResponseRuntime } from '../../transport/response/index.mjs'
import { createOrchestrationRuntime } from '../../orchestration/index.mjs'
import { createArtifactWorkerRuntime } from '../../utilities/artifacts/index.mjs'
import { createAgentWorkerRuntime } from '../../workers/runtime/index.mjs'
import { createRecoveryRuntime } from '../../supervision/recovery/index.mjs'

// Response observation, Worker task execution and Supervisor recovery.
export function composeWorkers(ctx) {
  compose(ctx, 'response', createResponseRuntime, {
    getRecoveryAction: () => ctx.performChatGPTRecoveryAction,
    getContinuationRecorder: () => ctx.recordChatGPTContinuationSent,
  })
  compose(ctx, 'orchestration', createOrchestrationRuntime)
  compose(ctx, 'artifact-workers', createArtifactWorkerRuntime)
  compose(ctx, 'agent-workers', createAgentWorkerRuntime, {
    desiredSupervisorSlots: ctx.getDesiredChatAgentSupervisorSlots,
    getDownloadPoller: () => ctx.pollExpectedChatGPTDownloadKey,
  })
  compose(ctx, 'recovery', createRecoveryRuntime)
}
