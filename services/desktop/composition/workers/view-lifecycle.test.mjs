import { readActivityRecoverySource } from '../supervision/activity-recovery-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const [viewEntry, viewSupervisor, viewWorker] = await Promise.all(['entry', 'supervisor', 'worker'].map((name) => readFile(new URL(`../../chatgpt/session/views/${name}.mjs`, import.meta.url), 'utf8')))

test('agent Chromium workers start after the first local shell paint', async () => {
  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const context = await readFile(new URL('../../lifecycle/startup/context.mjs', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../../lifecycle/startup/runtime.mjs', import.meta.url), 'utf8')
  assert.match(main, /primeChatGPTWorkerPool, CHAT_AGENT_STARTUP_DELAY_MS/)
  assert.match(context, /prime: primeChatGPTWorkerPool/)
  assert.match(context, /startupDelayMs: CHAT_AGENT_STARTUP_DELAY_MS/)
  assert.match(runtime, /scheduleWorkerStart\(async \(\) => \{[\s\S]*await worker\.prime\(workerHost\)[\s\S]*workerScheduler\.start\(\)[\s\S]*\}, worker\.startupDelayMs\)/)
  assert.match(await readFile(new URL('../../agent/scheduling/residency/worker-pool.mjs', import.meta.url), 'utf8'), /createChatGPTWorkerView\(`worker-\$\{index\}`, host\)[\s\S]*await wait\(CHAT_AGENT_WORKER_SPAWN_GAP_MS\)/)
})

test('hidden Worker views stay out of the local shell compositor until explicitly surfaced', async () => {
  const source = await readActivityRecoverySource()
  const createStart = viewWorker.indexOf('function createChatGPTWorkerView(')
  const createEnd = viewWorker.indexOf('\n  function retireChatGPTWorkerView', createStart)
  const create = viewWorker.slice(createStart, createEnd)
  const showStart = source.indexOf('function showChatAgentInteraction(')
  const showEnd = source.indexOf('\nfunction setChatAgentInteractionBounds', showStart)
  const show = source.slice(showStart, showEnd)
  assert.match(create, /attached: false/)
  assert.doesNotMatch(create, /contentView\.addChildView\(view\)/)
  assert.match(show, /windowState\.window\.contentView\.addChildView\(entry\.view\)/)
  assert.match(show, /entry\.attached = true/)
})

test('the Supervisor bound to a chat owns its expected-bundle observation whether visible or not, and Workers stand down from that lane', async () => {
  const source = await readActivityRecoverySource()

  const ownershipStart = source.indexOf('function chatGPTSupervisorOwnsExpectedResponse(')
  const ownershipEnd = source.indexOf('\nfunction supervisorBindingHold', ownershipStart)
  const ownership = source.slice(ownershipStart, ownershipEnd)
  // Ownership must NOT depend on which Supervisor happens to be painted: a
  // hidden Supervisor stays on its conversation for the whole request, which is
  // what removes the navigation a Worker would otherwise make.
  assert.doesNotMatch(ownership, /chatGPTEntryIsActiveVisible/)
  assert.match(ownership, /expectedChatGPTBundles\.get\(key\)/)
  assert.match(ownership, /sameConversationURL\(currentURL, expectedURL\)/)
  // Manual transport and an in-flight external login cannot be supervised at
  // all, so claiming the lane there would silence it for every pool.
  assert.match(ownership, /entry\.externalAuthProvider \|\| chatgptTransportModes\.get\(key\) === 'manual'/)

  const lanesStart = source.indexOf('function chatSupervisorBoundLanes(')
  const lanes = source.slice(lanesStart, source.indexOf('\nfunction reconcileChatGPTThrottle', lanesStart))
  assert.match(lanes, /supervisorBindingHeld\(key, entry\)/)
  assert.match(lanes, /lanes\.add\(`h:\$\{key\}`\)/)
  assert.match(lanes, /lanes\.add\(`c:\$\{conversationID\}`\)/)

  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('))
  const claimOptions = scheduler.slice(scheduler.indexOf('claimOptions: (worker)'), scheduler.indexOf('onIdle:'))
  assert.match(claimOptions, /const supervisorLanes = chatSupervisorBoundLanes\(\)/)
  assert.match(claimOptions, /releaseResidentLane\(entry\.slotId, residentLane\)/)
  assert.match(claimOptions, /fallback_mode: 'any', excluded_lanes: \[\]/)
  assert.match(claimOptions, /excluded_lanes: \[\.\.\.new Set\(\[\.\.\.pinnedElsewhere, \.\.\.\(fifo\.excluded_lanes \|\| \[\]\), \.\.\.supervisorLanes\]\)\]\.slice\(0, 32\)/)

  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const pollEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads()', pollStart)
  const poll = source.slice(pollStart, pollEnd)
  assert.match(poll, /if \(!entry \|\| !chatGPTSupervisorOwnsExpectedResponse\(key, expected\.requestId\)\) return/)
  // The poll is the only place that stamps structural progress, and the durable
  // supervision's stall bound reads that stamp.
  assert.match(poll, /if \(completion\?\.thinking === true \|\| completion\?\.complete === true\) expected\.progressAt = now/)
  const context = await readFile(new URL('../../lifecycle/startup/context.mjs', import.meta.url), 'utf8')
  assert.match(context, /state\.downloadPoller = setInterval\(\(\) => \{[\s\S]*void flushQueuedChatGPTComments\(\)[\s\S]*void pollChatGPTVisibleActivity\(\)[\s\S]*void pollExpectedChatGPTDownloads\(\)[\s\S]*void reconcileChatAgentAutoScale\(\)[\s\S]*\}, DOM_DOWNLOAD_POLL_MS\)/)
})

test('the two pools partition the durable queue: Supervisors take chat-bound work and Workers take everything smaller', async () => {
  const source = await readActivityRecoverySource()

  const workerPool = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('), source.indexOf('chatAgentScheduler.start()'))
  assert.match(workerPool, /role: 'worker'/)
  assert.match(workerPool, /execute: \(task, context\) => withTrace\(traceForTask\(task\), \(\) => chatAgentWorkerActivity\.run\(`worker-\$\{Number\(context\?\.worker\) \|\| 0\}`, task\.task_id, \(\) => executeChatAgentTask\(task, context\)\)\)/)

  const supervisorPool = source.slice(source.indexOf('chatSupervisorScheduler = new ChatAgentSchedulerClient('), source.indexOf('chatSupervisorScheduler.start()'))
  assert.match(supervisorPool, /role: 'supervisor'/)
  assert.match(supervisorPool, /execute: \(task, context\) => withTrace\(traceForTask\(task\), \(\) => executeChatSupervisorTask\(task, context\)\)/)
  assert.match(supervisorPool, /workerCount: desiredChatAgentSupervisorSlots, maxWorkers: HARD_MAX_SUPERVISOR_SLOTS/)
  assert.match(supervisorPool, /agentID: chatSupervisorSlotID/)
  // A Supervisor mid-request may claim only its own chat's lane: claiming
  // another conversation is the cross-chat navigation this topology removes.
  assert.match(supervisorPool, /supervisorBindingHeld\(key, entry\)[\s\S]{0,160}fallback_mode: 'resident_only'/)
  assert.match(supervisorPool, /excluded_lanes: \[\.\.\.taken\]\.slice\(0, 32\)/)

  const executeStart = source.indexOf('async function executeChatSupervisorTask(')
  const execute = source.slice(executeStart, source.indexOf('\nasync function executeChatAgentTask(', executeStart))
  for (const type of ['AWAIT_RESPONSE', 'BOT_WRITE', 'RECOVERY_WRITE']) {
    assert.match(execute, new RegExp(`case '${type}'`), `the Supervisor pool must run ${type}`)
  }
  for (const type of ['RENAME_CHAT', 'ORGANIZE_CHAT', 'ARCHIVE_CHAT', 'DELETE_CHAT', 'DELETE_BUNDLE', 'TRANSLATE_MARKDOWN', 'RELEASE_NOTES', 'ORCHESTRATOR_PLAN', 'TODO_CLASSIFY', 'TITLE_DISCOVER']) {
    assert.doesNotMatch(execute, new RegExp(`case '${type}'`), `${type} is small Worker work and must never reach a Supervisor`)
  }
  // The Worker cadence must not serialize Supervisors. Provider-wide suspension
  // remains checked above and after navigation, but no Worker pacer is touched.
  assert.doesNotMatch(execute, /paceChatGPTWorker(?:Navigation|Submission)/)
  assert.match(execute, /executeChatAgentWrite\(task, entry, key, payload, conversationURL, \{ pacedWorker: false \}\)/)
  assert.doesNotMatch(execute, /executeChatAgentOrchestratorPlan/)
  assert.match(source, /case 'ORCHESTRATOR_PLAN': return executeChatAgentOrchestratorPlan\(task, entry, key, payload, owner\)/)
  // Every slot still finishing a request is a free wait, never a charged attempt.
  assert.match(execute, /status: 'waiting', delayMs: CHAT_SUPERVISOR_SLOT_WAIT_MS, observation: true/)
})

test('background ChatGPT views disable renderer throttling and escalate structural or exhausted transport failures to human attention', async () => {
  const source = await readActivityRecoverySource()
  const preload = await readFile(new URL('../../preload.cjs', import.meta.url), 'utf8')
  const networkActivity = await readFile(new URL('../../chatgpt/session/health/network-activity.mjs', import.meta.url), 'utf8')
  const attention = await readFile(new URL('../../chatgpt/session/attention/notice.mjs', import.meta.url), 'utf8')
  const viewState = await readFile(new URL('../../chatgpt/session/views/state.mjs', import.meta.url), 'utf8')
  const createStart = viewSupervisor.indexOf('function createChatGPTView(cacheKey, windowState)')
  const create = viewSupervisor.slice(createStart)
  assert.match(create, /backgroundThrottling: false/)
  assert.match(source, /chatGPTHumanActionScript\(\)/)
  assert.match(source, /createChatGPTViewState\(\{/)
  assert.match(viewState, /humanAction: entry\?\.humanAction\?\.active/)
  assert.match(source, /createChatGPTHumanAttention\(\{/)
  assert.match(attention, /new Notification\(\{ title: 'Ação necessária no ChatGPT'/)
  assert.match(attention, /window\.flashFrame\(true\)/)
  assert.match(source, /CHATGPT_RATE_LIMIT_BACKOFF_MS = 7\.5 \* 60_000/)
  assert.match(viewEntry, /conversationRequests: new Map\(\)/)
  assert.match(viewEntry, /conversationTransportGeneration: 0/)
  assert.match(source, /createChatGPTNetworkActivity\(\{/)
  assert.match(networkActivity, /recordChatGPTConversationTransport\(entry\.conversationRequests, requestKey, entry\.conversationTransportGeneration, phase, now\)/)
  assert.match(viewSupervisor, /did-start-navigation[^\n]+advanceChatGPTConversationTransportGeneration\(entry\)/)
  assert.match(source, /transportActive: transport\.state === 'active'/)
  assert.match(source, /bundle DOM probe failed/)
  assert.match(source, /page load remained pending for more than 30 seconds/)
  assert.match(source, /\['surface', 'authentication', 'access'\]\.includes\(entry\.humanAction\.kind\)/)
  assert.match(preload, /wharness:chatgpt:human-action/)
})

test('idle backgrounded ChatGPT views may re-enable normal throttling, but never the active view or one Wharnex still needs to supervise', async () => {
  const source = await readActivityRecoverySource()
  const planWorker = await readFile(new URL('../../agent/orchestration/plan/worker.mjs', import.meta.url), 'utf8')
  const visibilityIPC = await readFile(new URL('../../chatgpt/session/ipc/visibility.mjs', import.meta.url), 'utf8')

  const needsStart = source.indexOf('function chatGPTEntryNeedsSupervision(key, entry)')
  const needsEnd = source.indexOf('\nfunction chatGPTEntryIsActiveVisible', needsStart)
  const needs = source.slice(needsStart, needsEnd)
  assert.match(needs, /entry\.loading/)
  assert.match(needs, /entry\.humanAction\?\.active/)
  assert.match(needs, /entry\.accountOperationActive/)
  assert.match(needs, /entry\.transportPreparationCount > 0/)
  assert.match(needs, /entry\.conversationRequests\.size > 0/)
  assert.match(needs, /pendingChatGPTComments\.has\(key\)/)
  // An armed expectation keeps its Supervisor at full speed whether or not that
  // slot is the painted one: a hidden Supervisor bound to its chat is the normal
  // case, and it is the surface the response will be collected from.
  //
  // That has to hold for every artifact Wharnex is waiting on, not only a
  // request bundle. TODO classification, markdown translation and orchestrator
  // plans run on a hidden Worker that holds no transport preparation across
  // the response wait, so a predicate that knew only about
  // `expectedChatGPTBundles` let Chromium background-throttle the renderer
  // streaming the answer, freezing it mid-response until the task timed out.
  assert.match(needs, /\|\| chatGPTArtifactExpectationArmed\(key\)\)/)
  assert.doesNotMatch(needs, /expectedChatGPTBundles\.has\(key\) && chatGPTEntryIsActiveVisible/)

  const armedStart = source.indexOf('function chatGPTArtifactExpectationArmed(key)')
  const armedEnd = source.indexOf('\nfunction reconcileChatGPTThrottleForKey', armedStart)
  const armed = source.slice(armedStart, armedEnd)
  assert.match(armed, /expectedChatGPTBundles\.has\(key\)/)
  for (const map of ['expectedChatGPTTranslations', 'expectedChatGPTTodoClassifications', 'expectedChatGPTOrchestratorPlans']) {
    assert.match(armed, new RegExp(map))
  }
  // Those three maps are keyed by result filename, so the cache key is matched
  // against the stored expectation rather than the map key.
  assert.match(armed, /expected\?\.key === key/)

  // A predicate change only takes effect where the throttle is reconciled, so
  // arming and disarming an expectation must both reconcile it - otherwise the
  // renderer keeps whatever throttle state it happened to have.
  for (const map of ['expectedChatGPTTranslations', 'expectedChatGPTTodoClassifications']) {
    assert.match(source, new RegExp(`${map}\\.set\\(filename, expected\\)\\n\\s*reconcileChatGPTThrottleForKey\\(key, entry\\)`))
    assert.match(source, new RegExp(`${map}\\.delete\\(filename\\); reconcileChatGPTThrottleForKey\\(key, entry\\)`))
  }

  assert.match(source, /createOrchestratorPlanWorker\(\{/)
  assert.match(planWorker, /expectedChatGPTOrchestratorPlans\.set\(filename, expected\)\n\s*reconcileChatGPTThrottleForKey\(key, entry\)/)
  assert.match(planWorker, /expectedChatGPTOrchestratorPlans\.delete\(filename\)\n\s*reconcileChatGPTThrottleForKey\(key, entry\)/)

  const reconcileStart = source.indexOf('function reconcileChatGPTThrottle(key, entry)')
  const reconcileEnd = source.indexOf('\nfunction sendToWindowState', reconcileStart)
  const reconcile = source.slice(reconcileStart, reconcileEnd)
  assert.match(reconcile, /chatGPTEntryIsActiveVisible\(key, entry\) \|\| chatGPTEntryNeedsSupervision\(key, entry\)/)
  assert.match(reconcile, /const wc = entry\?\.view\?\.webContents/)
  assert.match(reconcile, /wc\.setBackgroundThrottling\(!fullSpeed\)/)

  // Reconciled on every visibility transition (both the outgoing and the
  // incoming view) and on the existing bounded poller, never left to drift
  // until something else happens to touch that chat.
  const activateStart = source.indexOf('function activateChatGPTView(cacheKey, bounds, windowState)')
  const activateEnd = source.indexOf('\nfunction wait(', activateStart)
  const activate = source.slice(activateStart, activateEnd)
  assert.match(activate, /reconcileChatGPTThrottle\(previousKey, previous\)/)
  assert.match(activate, /reconcileChatGPTThrottle\(key, entry\)/)
  const hideStart = visibilityIPC.indexOf("ipcMain.handle('wharness:chatgpt:hide',")
  const hideEnd = visibilityIPC.indexOf("ipcMain.handle('wharness:chatgpt:set-bounds',", hideStart)
  const hideHandler = visibilityIPC.slice(hideStart, hideEnd)
  assert.match(source, /registerChatGPTSurfaceIPC\(\{/)
  assert.match(hideHandler, /reconcileChatGPTThrottle\(key, entry\)/)
  const pollStart = source.indexOf('async function pollChatGPTVisibleActivity()')
  const pollLoopStart = source.indexOf('for (const [key, entry] of chatgptViews)', pollStart)
  const pollLoop = source.slice(pollLoopStart, pollLoopStart + 200)
  assert.match(pollLoop, /reconcileChatGPTThrottle\(key, entry\)/)
})
