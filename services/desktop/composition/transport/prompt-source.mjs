import { readFile } from 'node:fs/promises'
import { readSchedulerStartupSource } from '../workers/scheduler-startup-source.mjs'
import { expandTransportRuntimeSource } from './runtime-source.mjs'
import { compositionSection } from '../entry/source.mjs'

// Legacy source-level tests inspect ordering across the Desktop composition.
// Reconstruct that order from the actual domain modules rather than keeping
// duplicate implementation text in the entry point.
export async function readPromptTransportSource() {
  let main = await expandTransportRuntimeSource(await readSchedulerStartupSource())
  const interaction = await readFile(new URL('../../agent/supervision/surface/worker-interaction.mjs', import.meta.url), 'utf8')
  const wiring = await readFile(new URL('../../agent/scheduling/wiring/desktop.mjs', import.meta.url), 'utf8')
  const wiringIndex = await readFile(new URL('../../agent/scheduling/index.mjs', import.meta.url), 'utf8')
  const interactionStart = interaction.indexOf('  function workerEntryForAgentID(')
  const interactionEnd = interaction.lastIndexOf('\n  return {')
  const { start: interactionCompositionStart, end: interactionCompositionEnd } = compositionSection(main, 'agent-scheduling')
  const surfaceIndex = await readFile(new URL('../../agent/supervision/surface/index.mjs', import.meta.url), 'utf8')
  if (interactionStart < 0 || interactionEnd <= interactionStart || interactionCompositionStart < 0
      || interactionCompositionEnd <= interactionCompositionStart || !surfaceIndex.includes("from './worker-interaction.mjs'")
      || !wiringIndex.includes("from './wiring/index.mjs'")
      || !wiring.includes('d.createWorkerInteraction({')
      || !wiring.includes('d.createChatAgentRuntimeRefresh({')) {
    throw new Error('Worker interaction domain composition missing')
  }
  main = `${main.slice(0, interactionCompositionEnd)}${interaction.slice(interactionStart, interactionEnd).replace(/^  /gm, '').trim()}\n${wiring}\n${main.slice(interactionCompositionEnd)}`
  const queue = await readFile(new URL('../../agent/scheduling/queue/task-operations.mjs', import.meta.url), 'utf8')
  const queueStart = queue.indexOf('  const CHAT_AGENT_REQUEST_BOUND_TASKS =')
  const queueEnd = queue.lastIndexOf('\n  return { chatAgentInitialRequestWaitMs,')
  const { start: queueCompositionStart, end: queueCompositionEnd } = compositionSection(main, 'agent-task-queue')
  const queueIndex = await readFile(new URL('../../agent/scheduling/queue/index.mjs', import.meta.url), 'utf8')
  if (queueStart < 0 || queueEnd <= queueStart || queueCompositionStart < 0
      || queueCompositionEnd <= queueCompositionStart || !queueIndex.includes("from './task-operations.mjs'")) {
    throw new Error('Chat agent task queue domain composition missing')
  }
  main = `${main.slice(0, queueCompositionStart)}${queue.slice(queueStart, queueEnd).replace(/^  /gm, '').trim()}\n${main.slice(queueCompositionEnd)}`
  const remote = await readFile(new URL('../../chatgpt/session/ownership/workspace-remote.mjs', import.meta.url), 'utf8')
  const remoteStart = remote.indexOf('  function durableWorkspaceChatID(')
  const remoteEnd = remote.lastIndexOf('\n  return { durableWorkspaceChatID,')
  const { start: remoteCompositionStart, end: remoteCompositionEnd } = compositionSection(main, 'workspace-chat-remote')
  const remoteOwnershipIndex = await readFile(new URL('../../chatgpt/session/ownership/index.mjs', import.meta.url), 'utf8')
  if (remoteStart < 0 || remoteEnd <= remoteStart || remoteCompositionStart < 0
      || remoteCompositionEnd <= remoteCompositionStart || !remoteOwnershipIndex.includes("from './workspace-remote.mjs'")) {
    throw new Error('Workspace chat remote domain composition missing')
  }
  main = `${main.slice(0, remoteCompositionStart)}${remote.slice(remoteStart, remoteEnd).replace(/^  /gm, '').trim()}\n${main.slice(remoteCompositionEnd)}`
  const followups = await readFile(new URL('../../agent/supervision/response/followups.mjs', import.meta.url), 'utf8')
  const followupsStart = followups.indexOf('  function expectedChatAgentPayload(')
  const followupsEnd = followups.lastIndexOf('\n  return { expectedChatAgentPayload, enqueueChatAgentFollowups }')
  const { start: followupsCompositionStart, end: followupsCompositionEnd } = compositionSection(main, 'agent-followups')
  const followupsIndex = await readFile(new URL('../../agent/supervision/response/index.mjs', import.meta.url), 'utf8')
  if (followupsStart < 0 || followupsEnd <= followupsStart || followupsCompositionStart < 0
      || followupsCompositionEnd <= followupsCompositionStart || !followupsIndex.includes("from './followups.mjs'")) {
    throw new Error('Response followup domain composition missing')
  }
  main = `${main.slice(0, followupsCompositionStart)}${followups.slice(followupsStart, followupsEnd).replace(/^  /gm, '').trim()}\n${main.slice(followupsCompositionEnd)}`
  const lineage = await readFile(new URL('../../agent/supervision/response/lineage.mjs', import.meta.url), 'utf8')
  const lineageStart = lineage.indexOf('  function recordChatGPTTaskEvent(')
  const lineageEnd = lineage.lastIndexOf('\n  return {')
  const lineageCompositionStart = main.indexOf('const {\n  recordChatGPTTaskEvent, hydrateExpectedChatAgentBundle,')
  const lineageCompositionEnd = main.indexOf('\nconst { probeChatAgentResponse }', lineageCompositionStart)
  const lineageIndex = await readFile(new URL('../../agent/supervision/response/index.mjs', import.meta.url), 'utf8')
  if (lineageStart < 0 || lineageEnd <= lineageStart || lineageCompositionStart < 0
      || lineageCompositionEnd <= lineageCompositionStart || !lineageIndex.includes("from './lineage.mjs'")) {
    throw new Error('Response lineage domain composition missing')
  }
  main = `${main.slice(0, lineageCompositionStart)}${lineage.slice(lineageStart, lineageEnd).replace(/^  /gm, '').trim()}\n${main.slice(lineageCompositionEnd)}`
  const request = await readFile(new URL('../../agent/orchestration/request/runtime.mjs', import.meta.url), 'utf8')
  const requestStart = request.indexOf('  async function orchestratorRequestSupervision(')
  const requestEnd = request.lastIndexOf('\n  return { orchestratorRequestSupervision,')
  const requestCompositionStart = main.indexOf('const {\n  orchestratorRequestSupervision, adoptOrchestratorRequest,')
  const requestCompositionEnd = main.indexOf('\nasync function chatAgentLifecycleBlocked(', requestCompositionStart)
  const requestIndex = await readFile(new URL('../../agent/orchestration/request/index.mjs', import.meta.url), 'utf8')
  if (requestStart < 0 || requestEnd <= requestStart || requestCompositionStart < 0
      || requestCompositionEnd <= requestCompositionStart || !requestIndex.includes("from './runtime.mjs'")) {
    throw new Error('Orchestrator request domain composition missing')
  }
  main = `${main.slice(0, requestCompositionStart)}${request.slice(requestStart, requestEnd).replace(/^  /gm, '').trim()}\n${main.slice(requestCompositionEnd)}`
  const planImport = await readFile(new URL('../../agent/orchestration/plan/import-runtime.mjs', import.meta.url), 'utf8')
  const planImportStart = planImport.indexOf('  async function importOrchestratorWorkerPlanBundle(')
  const planImportEnd = planImport.lastIndexOf('\n  return {')
  const planImportCompositionStart = main.indexOf('const {\n  importOrchestratorWorkerPlanBundle, importOrchestratorWorkerPlan,')
  const planImportCompositionEnd = main.indexOf('\nconst executeChatAgentOrchestratorPlan =', planImportCompositionStart)
  const planIndex = await readFile(new URL('../../agent/orchestration/plan/index.mjs', import.meta.url), 'utf8')
  if (planImportStart < 0 || planImportEnd <= planImportStart || planImportCompositionStart < 0
      || planImportCompositionEnd <= planImportCompositionStart || !planIndex.includes("from './import-runtime.mjs'")) {
    throw new Error('Orchestrator plan import domain composition missing')
  }
  main = `${main.slice(0, planImportCompositionStart)}${planImport.slice(planImportStart, planImportEnd).replace(/^  /gm, '').trim()}\n${main.slice(planImportCompositionEnd)}`
  const withTransport = main
  const lease = await readFile(new URL('../../agent/supervision/response/supervisor-lease.mjs', import.meta.url), 'utf8')
  const leaseStart = lease.indexOf('  async function superviseChatAgentResponse(')
  const leaseEnd = lease.lastIndexOf('\n  return { superviseChatAgentResponse }')
  const leaseCompositionStart = withTransport.indexOf('const { superviseChatAgentResponse } = createSupervisorResponseLease({')
  const leaseCompositionEnd = withTransport.indexOf('\nconst {\n  chatSupervisorHostWindow,', leaseCompositionStart)
  const responseIndex = await readFile(new URL('../../agent/supervision/response/index.mjs', import.meta.url), 'utf8')
  if (leaseStart < 0 || leaseEnd <= leaseStart || leaseCompositionStart < 0
      || leaseCompositionEnd <= leaseCompositionStart || !responseIndex.includes("from './supervisor-lease.mjs'")) {
    throw new Error('Supervisor response lease composition missing')
  }
  const withLease = `${withTransport.slice(0, leaseCompositionStart)}${lease.slice(leaseStart, leaseEnd).replace(/^  /gm, '').trim()}\n${withTransport.slice(leaseCompositionEnd)}`
  const pool = await readFile(new URL('../../agent/supervision/ownership/pool.mjs', import.meta.url), 'utf8')
  const poolStart = pool.indexOf('  function chatSupervisorHostWindow()')
  const poolEnd = pool.lastIndexOf('\n  return { chatSupervisorHostWindow,')
  const poolCompositionStart = withLease.indexOf('const {\n  chatSupervisorHostWindow, bindChatSupervisor,')
  const poolCompositionEnd = withLease.indexOf('\nconst { executeChatTranslatorTask }', poolCompositionStart)
  const ownershipIndex = await readFile(new URL('../../agent/supervision/ownership/index.mjs', import.meta.url), 'utf8')
  if (poolStart < 0 || poolEnd <= poolStart || poolCompositionStart < 0
      || poolCompositionEnd <= poolCompositionStart || !ownershipIndex.includes("from './pool.mjs'")) {
    throw new Error('Supervisor pool domain composition missing')
  }
  const withPool = `${withLease.slice(0, poolCompositionStart)}${pool.slice(poolStart, poolEnd).replace(/^  /gm, '').trim()}\n${withLease.slice(poolCompositionEnd)}`
  const write = await readFile(new URL('../../agent/supervision/response/write.mjs', import.meta.url), 'utf8')
  const writeStart = write.indexOf('  async function executeChatAgentWrite(')
  const writeEnd = write.lastIndexOf('\n  return { executeChatAgentWrite }')
  const writeCompositionStart = withPool.indexOf('const { executeChatAgentWrite } = createAgentWrite({')
  const writeCompositionEnd = withPool.indexOf('\nconst { executeChatAgentTitleDiscover, executeChatAgentTempTitle, executeChatAgentTitleAwait } = createLegacyTitleTasks({', writeCompositionStart)
  if (writeStart < 0 || writeEnd <= writeStart || writeCompositionStart < 0
      || writeCompositionEnd <= writeCompositionStart || !responseIndex.includes("from './write.mjs'")) {
    throw new Error('Agent write domain composition missing')
  }
  const withWrite = `${withPool.slice(0, writeCompositionStart)}${write.slice(writeStart, writeEnd).replace(/^  /gm, '').trim()}\n${withPool.slice(writeCompositionEnd)}`
  const legacyTitle = await readFile(new URL('../../agent/scheduling/execution/title-compatibility.mjs', import.meta.url), 'utf8')
  const titleStart = legacyTitle.indexOf('  async function executeChatAgentTitleDiscover(')
  const titleEnd = legacyTitle.lastIndexOf('\n  return { executeChatAgentTitleDiscover,')
  const titleCompositionStart = withWrite.indexOf('const { executeChatAgentTitleDiscover, executeChatAgentTempTitle, executeChatAgentTitleAwait } = createLegacyTitleTasks({')
  const titleCompositionEnd = withWrite.indexOf('\nfunction releaseNotesWorkerRuntime()', titleCompositionStart)
  const executionIndex = await readFile(new URL('../../agent/scheduling/execution/index.mjs', import.meta.url), 'utf8')
  if (titleStart < 0 || titleEnd <= titleStart || titleCompositionStart < 0
      || titleCompositionEnd <= titleCompositionStart || !executionIndex.includes("from './title-compatibility.mjs'")) {
    throw new Error('Legacy title task domain composition missing')
  }
  return `${withWrite.slice(0, titleCompositionStart)}${legacyTitle.slice(titleStart, titleEnd).replace(/^  /gm, '').trim()}\n${withWrite.slice(titleCompositionEnd)}`
}
