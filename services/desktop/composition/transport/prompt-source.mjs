import { readFile } from 'node:fs/promises'
import { readSchedulerStartupSource } from '../workers/scheduler-startup-source.mjs'
import { expandPromptPreparationSource } from './preparation-source.mjs'

const sections = [
  ['preparation/prepare.mjs', 'async function preparePromptForChatGPT('],
  ['preparation/queue.mjs', 'async function queuePreparedPromptForWorker('],
  ['retry/persisted.mjs', 'async function retryPersistedChatGPTPrompt('],
  ['retry/prepared.mjs', 'async function retryPreparedChatGPTPrompt('],
  ['manual/attach.mjs', 'async function attachContextToChatGPT('],
  ['submission/prepared.mjs', 'async function submitPreparedChatGPTDraft('],
  ['submission/prompt.mjs', 'async function submitPromptToChatGPT('],
  ['continuation/continue.mjs', 'function automaticChatGPTContinuationBlockReason('],
]

// Legacy source-level tests inspect ordering across the Desktop composition.
// Reconstruct that order from the actual domain modules rather than keeping
// duplicate implementation text in main.mjs.
export async function readPromptTransportSource() {
  let main = await readSchedulerStartupSource()
  const interaction = await readFile(new URL('../../agent/supervision/surface/worker-interaction.mjs', import.meta.url), 'utf8')
  const wiring = await readFile(new URL('../../agent/scheduling/wiring/desktop.mjs', import.meta.url), 'utf8')
  const wiringIndex = await readFile(new URL('../../agent/scheduling/index.mjs', import.meta.url), 'utf8')
  const interactionStart = interaction.indexOf('  function workerEntryForAgentID(')
  const interactionEnd = interaction.lastIndexOf('\n  return {')
  const interactionCompositionStart = main.indexOf('const desktopAgentScheduling = createDesktopAgentScheduling({')
  const interactionCompositionEnd = main.indexOf('const chatAgentBrowserSnapshot = desktopAgentScheduling.chatAgentBrowserSnapshot', interactionCompositionStart)
  const surfaceIndex = await readFile(new URL('../../agent/supervision/surface/index.mjs', import.meta.url), 'utf8')
  if (interactionStart < 0 || interactionEnd <= interactionStart || interactionCompositionStart < 0
      || interactionCompositionEnd <= interactionCompositionStart || !surfaceIndex.includes("from './worker-interaction.mjs'")
      || !wiringIndex.includes("from './wiring/index.mjs'")
      || !wiring.includes('d.createWorkerInteraction({')
      || !wiring.includes('d.createChatAgentRuntimeRefresh({')) {
    throw new Error('Worker interaction domain composition missing from main.mjs')
  }
  main = `${main.slice(0, interactionCompositionEnd)}${interaction.slice(interactionStart, interactionEnd).replace(/^  /gm, '').trim()}\n${wiring}\n${main.slice(interactionCompositionEnd)}`
  main = await expandPromptPreparationSource(main)
  const pacing = await readFile(new URL('../../agent/scheduling/residency/worker-pacing.mjs', import.meta.url), 'utf8')
  const pacingStart = pacing.indexOf('  function chatAgentNavigationGapMs()')
  const pacingEnd = pacing.lastIndexOf('\n  return {')
  const pacingCompositionStart = main.indexOf('const {\n  ChatGPTRateLimitDeferral, ChatGPTConversationUnavailable,')
  const pacingCompositionEnd = main.indexOf('\nconst { pasteChatGPTFile } = createChatGPTFileUpload({', pacingCompositionStart)
  const residencyIndex = await readFile(new URL('../../agent/scheduling/residency/index.mjs', import.meta.url), 'utf8')
  if (pacingStart < 0 || pacingEnd <= pacingStart || pacingCompositionStart < 0
      || pacingCompositionEnd <= pacingCompositionStart || !residencyIndex.includes("from './worker-pacing.mjs'")) {
    throw new Error('Worker pacing domain composition missing from main.mjs')
  }
  main = `${main.slice(0, pacingCompositionStart)}${pacing.slice(pacingStart, pacingEnd).replace(/^  /gm, '').trim()}\n${main.slice(pacingCompositionEnd)}`
  const upload = await readFile(new URL('../../chatgpt/transport/uploads/paste-runtime.mjs', import.meta.url), 'utf8')
  const uploadStart = upload.indexOf('  async function pasteChatGPTFile(')
  const uploadEnd = upload.lastIndexOf('\n  return { pasteChatGPTFile }')
  const uploadCompositionStart = main.indexOf('const { pasteChatGPTFile } = createChatGPTFileUpload({')
  const uploadCompositionEnd = main.indexOf('\n// Keep the account-specific control interaction', uploadCompositionStart)
  const uploadIndex = await readFile(new URL('../../chatgpt/transport/uploads/index.mjs', import.meta.url), 'utf8')
  if (uploadStart < 0 || uploadEnd <= uploadStart || uploadCompositionStart < 0
      || uploadCompositionEnd <= uploadCompositionStart || !uploadIndex.includes("from './paste-runtime.mjs'")) {
    throw new Error('ChatGPT file upload domain composition missing from main.mjs')
  }
  main = `${main.slice(0, uploadCompositionStart)}${upload.slice(uploadStart, uploadEnd).replace(/^  /gm, '').trim()}\n${main.slice(uploadCompositionEnd)}`
  const queue = await readFile(new URL('../../agent/scheduling/queue/task-operations.mjs', import.meta.url), 'utf8')
  const queueStart = queue.indexOf('  const CHAT_AGENT_REQUEST_BOUND_TASKS =')
  const queueEnd = queue.lastIndexOf('\n  return { chatAgentInitialRequestWaitMs,')
  const queueCompositionStart = main.indexOf('const {\n  chatAgentInitialRequestWaitMs, chatAgentRequestEligibleAt,')
  const queueCompositionEnd = main.indexOf('\nconst { expectedChatAgentPayload, enqueueChatAgentFollowups } = createChatAgentFollowups({', queueCompositionStart)
  const queueIndex = await readFile(new URL('../../agent/scheduling/queue/index.mjs', import.meta.url), 'utf8')
  if (queueStart < 0 || queueEnd <= queueStart || queueCompositionStart < 0
      || queueCompositionEnd <= queueCompositionStart || !queueIndex.includes("from './task-operations.mjs'")) {
    throw new Error('Chat agent task queue domain composition missing from main.mjs')
  }
  main = `${main.slice(0, queueCompositionStart)}${queue.slice(queueStart, queueEnd).replace(/^  /gm, '').trim()}\n${main.slice(queueCompositionEnd)}`
  const remote = await readFile(new URL('../../chatgpt/session/ownership/workspace-remote.mjs', import.meta.url), 'utf8')
  const remoteStart = remote.indexOf('  function durableWorkspaceChatID(')
  const remoteEnd = remote.lastIndexOf('\n  return { durableWorkspaceChatID,')
  const remoteCompositionStart = main.indexOf('const {\n  durableWorkspaceChatID, persistWorkspaceChatRemote,')
  const remoteCompositionEnd = main.indexOf('\nconst chatAgentConversationURL = createChatAgentConversationURL(', remoteCompositionStart)
  const remoteOwnershipIndex = await readFile(new URL('../../chatgpt/session/ownership/index.mjs', import.meta.url), 'utf8')
  if (remoteStart < 0 || remoteEnd <= remoteStart || remoteCompositionStart < 0
      || remoteCompositionEnd <= remoteCompositionStart || !remoteOwnershipIndex.includes("from './workspace-remote.mjs'")) {
    throw new Error('Workspace chat remote domain composition missing from main.mjs')
  }
  main = `${main.slice(0, remoteCompositionStart)}${remote.slice(remoteStart, remoteEnd).replace(/^  /gm, '').trim()}\n${main.slice(remoteCompositionEnd)}`
  const followups = await readFile(new URL('../../agent/supervision/response/followups.mjs', import.meta.url), 'utf8')
  const followupsStart = followups.indexOf('  function expectedChatAgentPayload(')
  const followupsEnd = followups.lastIndexOf('\n  return { expectedChatAgentPayload, enqueueChatAgentFollowups }')
  const followupsCompositionStart = main.indexOf('const { expectedChatAgentPayload, enqueueChatAgentFollowups } = createChatAgentFollowups({')
  const followupsCompositionEnd = main.indexOf('\n// Durably records one decision', followupsCompositionStart)
  const followupsIndex = await readFile(new URL('../../agent/supervision/response/index.mjs', import.meta.url), 'utf8')
  if (followupsStart < 0 || followupsEnd <= followupsStart || followupsCompositionStart < 0
      || followupsCompositionEnd <= followupsCompositionStart || !followupsIndex.includes("from './followups.mjs'")) {
    throw new Error('Response followup domain composition missing from main.mjs')
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
    throw new Error('Response lineage domain composition missing from main.mjs')
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
    throw new Error('Orchestrator request domain composition missing from main.mjs')
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
    throw new Error('Orchestrator plan import domain composition missing from main.mjs')
  }
  main = `${main.slice(0, planImportCompositionStart)}${planImport.slice(planImportStart, planImportEnd).replace(/^  /gm, '').trim()}\n${main.slice(planImportCompositionEnd)}`
  const draft = await readFile(new URL('../../chatgpt/transport/requests/submission/draft.mjs', import.meta.url), 'utf8')
  const draftStart = draft.indexOf('  async function submitChatGPTDraft(')
  const draftEnd = draft.lastIndexOf('\n  return { submitChatGPTDraft }')
  const draftCompositionStart = main.indexOf('const { submitChatGPTDraft } = createChatGPTDraftSubmission({')
  const draftCompositionEnd = main.indexOf('\nconst {\n  preparePromptForChatGPT,', draftCompositionStart)
  const submissionIndex = await readFile(new URL('../../chatgpt/transport/requests/submission/index.mjs', import.meta.url), 'utf8')
  if (draftStart < 0 || draftEnd <= draftStart || draftCompositionStart < 0 || draftCompositionEnd <= draftCompositionStart
      || !submissionIndex.includes("from './draft.mjs'")) throw new Error('Draft submission domain composition missing')
  main = `${main.slice(0, draftCompositionStart)}${draft.slice(draftStart, draftEnd).replace(/^  /gm, '').trim()}\n${main.slice(draftCompositionEnd)}`
  const bodies = await Promise.all(sections.map(async ([file, signature]) => {
    const module = await readFile(new URL(`../../chatgpt/transport/requests/${file}`, import.meta.url), 'utf8')
    const start = module.indexOf(`  ${signature}`)
    const end = module.lastIndexOf('\n  return {')
    if (start < 0 || end <= start) throw new Error(`Prompt source section missing: ${file}`)
    return module.slice(start, end).replace(/^  /gm, '').trim()
  }))
  const start = main.indexOf('const {\n  preparePromptForChatGPT,')
  const end = main.indexOf('\nfunction durableWorkspaceChatID(', start)
  const transport = await readFile(new URL('../../chatgpt/transport/index.mjs', import.meta.url), 'utf8')
  const requests = await readFile(new URL('../../chatgpt/transport/requests/index.mjs', import.meta.url), 'utf8')
  if (start < 0 || end <= start || !main.includes("from './chatgpt/transport/index.mjs'")
      || !transport.includes("createChatGPTPromptTransport") || !requests.includes("from './prompt-index.mjs'")) {
    throw new Error('Prompt transport domain composition missing from main.mjs')
  }
  const withTransport = `${main.slice(0, start)}${bodies.join('\n\n')}\n${main.slice(end)}`
  const lease = await readFile(new URL('../../agent/supervision/response/supervisor-lease.mjs', import.meta.url), 'utf8')
  const leaseStart = lease.indexOf('  async function superviseChatAgentResponse(')
  const leaseEnd = lease.lastIndexOf('\n  return { superviseChatAgentResponse }')
  const leaseCompositionStart = withTransport.indexOf('const { superviseChatAgentResponse } = createSupervisorResponseLease({')
  const leaseCompositionEnd = withTransport.indexOf('\nconst {\n  chatSupervisorHostWindow,', leaseCompositionStart)
  const responseIndex = await readFile(new URL('../../agent/supervision/response/index.mjs', import.meta.url), 'utf8')
  if (leaseStart < 0 || leaseEnd <= leaseStart || leaseCompositionStart < 0
      || leaseCompositionEnd <= leaseCompositionStart || !responseIndex.includes("from './supervisor-lease.mjs'")) {
    throw new Error('Supervisor response lease composition missing from main.mjs')
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
    throw new Error('Supervisor pool domain composition missing from main.mjs')
  }
  const withPool = `${withLease.slice(0, poolCompositionStart)}${pool.slice(poolStart, poolEnd).replace(/^  /gm, '').trim()}\n${withLease.slice(poolCompositionEnd)}`
  const write = await readFile(new URL('../../agent/supervision/response/write.mjs', import.meta.url), 'utf8')
  const writeStart = write.indexOf('  async function executeChatAgentWrite(')
  const writeEnd = write.lastIndexOf('\n  return { executeChatAgentWrite }')
  const writeCompositionStart = withPool.indexOf('const { executeChatAgentWrite } = createAgentWrite({')
  const writeCompositionEnd = withPool.indexOf('\nconst { executeChatAgentTitleDiscover, executeChatAgentTempTitle, executeChatAgentTitleAwait } = createLegacyTitleTasks({', writeCompositionStart)
  if (writeStart < 0 || writeEnd <= writeStart || writeCompositionStart < 0
      || writeCompositionEnd <= writeCompositionStart || !responseIndex.includes("from './write.mjs'")) {
    throw new Error('Agent write domain composition missing from main.mjs')
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
    throw new Error('Legacy title task domain composition missing from main.mjs')
  }
  return `${withWrite.slice(0, titleCompositionStart)}${legacyTitle.slice(titleStart, titleEnd).replace(/^  /gm, '').trim()}\n${withWrite.slice(titleCompositionEnd)}`
}
