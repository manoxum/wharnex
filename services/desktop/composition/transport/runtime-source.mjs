import { readFile } from 'node:fs/promises'
import { compositionSection } from '../entry/source.mjs'

const sections = [
  {
    file: './response/runtime.mjs', index: './response/index.mjs', exportName: 'createResponseRuntime',
    stage: 'response', body: '  // Durably records one decision',
  },
  {
    file: '../orchestration/runtime.mjs', index: '../orchestration/index.mjs', exportName: 'createOrchestrationRuntime',
    stage: 'orchestration', body: '  function releaseNotesWorkerRuntime()',
  },
  {
    file: '../utilities/artifacts/runtime.mjs', index: '../utilities/artifacts/index.mjs', exportName: 'createArtifactWorkerRuntime',
    stage: 'artifact-workers', body: '  // Transport for one translation request.',
  },
  {
    file: '../workers/runtime/runtime.mjs', index: '../workers/runtime/index.mjs', exportName: 'createAgentWorkerRuntime',
    stage: 'agent-workers', body: '  async function chatAgentLifecycleRetry(',
  },
  {
    file: '../supervision/recovery/runtime.mjs', index: '../supervision/recovery/index.mjs', exportName: 'createRecoveryRuntime',
    stage: 'recovery', body: '  const { queueChatGPTComment, hasPendingChatGPTComments, flushQueuedChatGPTComments }',
  },
]

// Source-level regression tests retain their cross-domain view, but read the
// implementation from the compositions actually imported by the entry point.
export async function expandTransportRuntimeSource(main) {
  let source = main
  for (const section of sections) {
    const [module, index] = await Promise.all([
      readFile(new URL(section.file, import.meta.url), 'utf8'),
      readFile(new URL(section.index, import.meta.url), 'utf8'),
    ])
    const { start, end } = compositionSection(source, section.stage)
    const bodyStart = module.indexOf(section.body)
    const bodyEnd = module.lastIndexOf('\n  return {')
    if (Math.min(start, end, bodyStart, bodyEnd) < 0 || end <= start || bodyEnd <= bodyStart
        || !index.includes(section.exportName) || !source.includes(section.exportName)) {
      throw new Error(`Desktop transport composition missing: ${section.exportName}`)
    }
    const body = module.slice(bodyStart, bodyEnd).replace(/^  /gm, '').trim()
    source = `${source.slice(0, start)}${body}\n${source.slice(end)}`
  }
  return source
}
