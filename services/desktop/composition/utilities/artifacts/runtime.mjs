import { createArtifactWorkers } from '../../../agent/index.mjs'

export function createArtifactWorkerRuntime(deps) {
  // Transport for one translation request.
  //
  // The worker composes nothing. The backend's translation engine built the
  // request bundle, wrote the instruction into it, and named the exact artifact
  // that counts as an answer; this function uploads that archive, waits for that
  // exact filename, and returns the bytes it downloaded without reading them. The
  // engine that authored the contract is the one that validates the reply.
  //
  // That is the whole reason translation moved onto a bundle. When the worker
  // pasted a prose instruction and hoped for a Markdown file back, an answer in
  // the wrong shape — prose, the source echoed back, a differently named file —
  // was indistinguishable from no answer, so the job sat in the queue until it
  // timed out. A bundle can be wrong in ways that have names.
  
  const { executeChatAgentMarkdownTranslation, executeChatAgentTodoClassification } = createArtifactWorkers(deps)
  return { executeChatAgentMarkdownTranslation, executeChatAgentTodoClassification }
}
