import { createMarkdownTranslationWorker } from '../translation/index.mjs'
import { createTodoClassificationWorker } from '../todo/index.mjs'
export { createEphemeralWorkerRuntime } from './ephemeral-runtime.mjs'

export function createArtifactWorkers(context) {
  return {
    ...createMarkdownTranslationWorker(context),
    ...createTodoClassificationWorker(context),
  }
}
