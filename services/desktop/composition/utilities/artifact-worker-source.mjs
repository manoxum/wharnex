import { readFile } from 'node:fs/promises'
import { readDownloadSupervisionSource } from '../supervision/download-source.mjs'

const sections = [
  ['translation/worker.mjs', 'async function executeChatAgentMarkdownTranslation('],
  ['todo/classification-worker.mjs', 'async function executeChatAgentTodoClassification('],
]

export async function readArtifactWorkersSource() {
  const main = await readDownloadSupervisionSource()
  const bodies = await Promise.all(sections.map(async ([file, signature]) => {
    const module = await readFile(new URL(`../../agent/automation/${file}`, import.meta.url), 'utf8')
    const start = module.indexOf(`  ${signature}`)
    const end = module.lastIndexOf('\n  return {')
    if (start < 0 || end <= start) throw new Error(`Artifact worker section missing: ${file}`)
    return module.slice(start, end).replace(/^  /gm, '').trim()
  }))
  const start = main.indexOf('const { executeChatAgentMarkdownTranslation, executeChatAgentTodoClassification, executeUITestingTask } = createArtifactWorkers(deps)')
  const end = main.indexOf('\nasync function chatAgentLifecycleRetry(', start)
  const agent = await readFile(new URL('../../agent/index.mjs', import.meta.url), 'utf8')
  const automation = await readFile(new URL('../../agent/automation/index.mjs', import.meta.url), 'utf8')
  const artifactComposition = await readFile(new URL('./artifacts/index.mjs', import.meta.url), 'utf8')
  if (start < 0 || end <= start || !main.includes("from './agent/index.mjs'")
      || !agent.includes('createArtifactWorkers') || !automation.includes("from './artifact-workers/index.mjs'")
      || !artifactComposition.includes("from './runtime.mjs'")) {
    throw new Error('Artifact worker domain composition missing')
  }
  const source = `${main.slice(0, start)}${bodies.join('\n\n')}\n${main.slice(end)}`
  const ephemeralStart = source.indexOf('const { executeEphemeralWorkerTask } = createEphemeralWorkerRuntime({')
  const ephemeralEnd = source.indexOf('\nconst { executeChatAgentTask } = createChatAgentExecution({', ephemeralStart)
  const ephemeralModule = await readFile(new URL('../../agent/automation/artifact-workers/ephemeral-runtime.mjs', import.meta.url), 'utf8')
  const implementationStart = ephemeralModule.indexOf('  function retireEphemeralWorkerView(')
  const implementationEnd = ephemeralModule.lastIndexOf('\n  return { retireEphemeralWorkerView, executeEphemeralWorkerTask }')
  const artifactIndex = await readFile(new URL('../../agent/automation/artifact-workers/index.mjs', import.meta.url), 'utf8')
  if (ephemeralStart < 0 || ephemeralEnd <= ephemeralStart || implementationStart < 0 || implementationEnd <= implementationStart
      || !agent.includes('createEphemeralWorkerRuntime') || !automation.includes("from './artifact-workers/index.mjs'")
      || !artifactIndex.includes("from './ephemeral-runtime.mjs'")) {
    throw new Error('Ephemeral Worker domain composition missing from main.mjs')
  }
  const implementation = ephemeralModule.slice(implementationStart, implementationEnd).replace(/^  /gm, '').trim()
  const withEphemeral = `${source.slice(0, ephemeralStart)}${implementation}\n${source.slice(ephemeralEnd)}`
  const translator = await readFile(new URL('../../agent/automation/translation/task-runtime.mjs', import.meta.url), 'utf8')
  const translatorStart = translator.indexOf('  async function executeChatTranslatorTask(')
  const translatorEnd = translator.lastIndexOf('\n  return { executeChatTranslatorTask }')
  const translatorCompositionStart = withEphemeral.indexOf('const { executeChatTranslatorTask } = createTranslatorTaskRuntime({')
  const translatorCompositionEnd = withEphemeral.indexOf('\nconst ephemeralWorkerViews = new Map()', translatorCompositionStart)
  const translationIndex = await readFile(new URL('../../agent/automation/translation/index.mjs', import.meta.url), 'utf8')
  if (translatorStart < 0 || translatorEnd <= translatorStart || translatorCompositionStart < 0
      || translatorCompositionEnd <= translatorCompositionStart || !agent.includes('createTranslatorTaskRuntime')
      || !translationIndex.includes("from './task-runtime.mjs'")) {
    throw new Error('Translator task runtime composition missing from main.mjs')
  }
  const translatorBody = translator.slice(translatorStart, translatorEnd).replace(/^  /gm, '').trim()
  return `${withEphemeral.slice(0, translatorCompositionStart)}${translatorBody}\n${withEphemeral.slice(translatorCompositionEnd)}`
}
