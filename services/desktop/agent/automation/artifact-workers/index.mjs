import { createMarkdownTranslationWorker } from '../translation/index.mjs'
import { createTodoClassificationWorker } from '../todo/index.mjs'
import { createUITestingWorker } from '../ui-testing/index.mjs'
export { createEphemeralWorkerRuntime } from './ephemeral-runtime.mjs'
export { markdownTranslationFilename, todoClassificationFilename, uiTestingDiscoveryFilename } from './filenames.mjs'
export { EPHEMERAL_WORKER_TASK_TYPES, EPHEMERAL_AGENT_ID, EPHEMERAL_WORKER_LABELS, EPHEMERAL_WORKER_IDLE_RETIRE_MS, EPHEMERAL_WORKER_PACE_PRIORITY } from './ephemeral-config.mjs'

export function createArtifactWorkers(context) {
  return {
    ...createMarkdownTranslationWorker(context),
    ...createTodoClassificationWorker(context),
    ...createUITestingWorker(context),
  }
}
