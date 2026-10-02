import { readPromptTransportSource } from '../transport/prompt-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('an Orchestrator execution Worker stays pinned to its task and others stay off that lane', async () => {
  const source = await readPromptTransportSource()
  const capacity = await readFile(new URL('../../agent/scheduling/capacity/availability.mjs', import.meta.url), 'utf8')
  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('))
  assert.match(scheduler.slice(0, 1200), /\.then\(\(result\) => \{ noteOrchestrationTaskPin\(context\?\.worker, task, result\); return result \}/)
  const claimOptions = scheduler.slice(scheduler.indexOf('claimOptions: (worker)'), scheduler.indexOf('onIdle:'))
  assert.match(claimOptions, /if \(pinnedLane\) return \{ \.\.\.scope, preferred_lane: pinnedLane, fallback_mode: 'resident_only', excluded_lanes: \[\] \}/)
  assert.match(claimOptions, /const pinnedElsewhere = orchestrationTaskPins\.lanesHeldByOthers\(entry\.slotId\)/)
  const onIdle = scheduler.slice(scheduler.indexOf('onIdle: (worker)'), scheduler.indexOf('onState:'))
  assert.match(onIdle, /if \(orchestrationTaskPins\.lane\(entry\.slotId\)\) \{/)
  // A pinned Worker is not free capacity for auto scale.
  const available = capacity.slice(capacity.indexOf('function chatAgentAvailableWorkers('))
  assert.match(available.slice(0, 900), /if \(orchestrationTaskPins\.lane\(entry\.slotId\)\) continue/)
})

test('auto scale never drains below a Worker pinned to an Orchestrator task', async () => {
  const source = await readFile(new URL('../../agent/scheduling/capacity/availability.mjs', import.meta.url), 'utf8')
  const floor = source.slice(source.indexOf('function chatAgentKeepFlowingFloor('))
  assert.match(floor.slice(0, 500), /chatAgentKeepFlowingActive\(worker\) \|\| \(entry && orchestrationTaskPins\.lane\(entry\.slotId\)\)/)
})

test('translation, planning and release notes run on their own ephemeral Workers', async () => {
  const source = await readPromptTransportSource()
  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const context = await readFile(new URL('../../lifecycle/startup/context.mjs', import.meta.url), 'utf8')
  const ephemeralSource = await readFile(new URL('../../agent/automation/artifact-workers/ephemeral-runtime.mjs', import.meta.url), 'utf8')
  const ephemeralConfig = await readFile(new URL('../../agent/automation/artifact-workers/ephemeral-config.mjs', import.meta.url), 'utf8')
  const workerRuntime = await readFile(new URL('../workers/runtime/runtime.mjs', import.meta.url), 'utf8')
  assert.match(source, /EPHEMERAL_WORKER_TASK_TYPES/)
  assert.match(ephemeralConfig, /const EPHEMERAL_WORKER_TASK_TYPES = new Set\(\['TRANSLATE_MARKDOWN', 'ORCHESTRATOR_PLAN', 'RELEASE_NOTES', 'UI_TEST_DISCOVER', 'UI_TEST_RUN'\]\)/)
  assert.match(main, /createAgentWorkerRuntime\(\{/)
  assert.match(workerRuntime, /createEphemeralWorkerRuntime\(\{/)
  const ephemeral = ephemeralSource.slice(ephemeralSource.indexOf('async function executeEphemeralWorkerTask('))
  // A WAITING observation keeps the view on its conversation; anything else retires it.
  assert.match(ephemeral.slice(0, 2500), /if \(String\(result\?\.status \|\| ''\) !== 'waiting'\) retireEphemeralWorkerView/)
  assert.match(ephemeral.slice(0, 2500), /\{ priority: EPHEMERAL_WORKER_PACE_PRIORITY \}/)
  const scheduler = source.slice(source.indexOf('chatTranslatorScheduler = new ChatAgentSchedulerClient('))
  assert.match(main, /get dueTranslations\(\) \{ return desktopState\.agent\.dueChatTranslations \}/)
  assert.match(context, /getDueChatTranslations: \(\) => state\.dueTranslations/)
  assert.match(scheduler.slice(0, 1500), /skip: !\[\.\.\.desktopWindows\.values\(\)\]\.some\(\(state\) => state\.window && !state\.window\.isDestroyed\(\)\) \|\| getDueChatTranslations\(\) === 0,/)
  assert.doesNotMatch(source, /chatAgentTranslationWorkersAvailable/)
})

test('an Orchestrator task round travels on the agentic Main Request transport', async () => {
  const source = await readPromptTransportSource()
  const delivery = await readFile(new URL('../../agent/orchestration/task-bundle-delivery.mjs', import.meta.url), 'utf8')
  const send = source.slice(source.indexOf('async function sendOrchestratorMainRequest('))
  assert.match(send.slice(0, 1600), /preparePromptForChatGPT\(\{\n\s+orchestratorTask: true, bundleChatId: current\.chat_id,/)
  // Its bundle goes straight to the backend: a task has no renderer.
  const publish = await readFile(new URL('../../chatgpt/downloads/registration/publication.mjs', import.meta.url), 'utf8')
  assert.match(source, /createChatGPTDownloadPublication\(\{/)
  assert.match(publish.slice(publish.indexOf('function publishBundleDownload(')), /const orchestratorTaskId = orchestratorTaskIdForBundle\(payload\)\n\s+if \(orchestratorTaskId\) \{\n\s+void deliverOrchestratorTaskBundle/)
  const deliver = delivery.slice(delivery.indexOf('async function deliverOrchestratorTaskBundle('))
  assert.match(deliver.slice(0, 4000), /postTask\(taskId, 'bundle'/)
  assert.match(deliver.slice(0, 4000), /await acknowledge\(key, requestId, filename\)/)
  // A repairable rejection is one more agentic recovery write in the same conversation.
  assert.match(deliver.slice(0, 4000), /enqueue\('RECOVERY_WRITE'/)
  assert.match(deliver.slice(0, 4000), /postTask\(taskId, 'fail-run'/)
})

test('a task bundle is delivered on the long-running request, never on a five-minute fetch', async () => {
  const source = await readPromptTransportSource()
  const delivery = await readFile(new URL('../../agent/orchestration/task-bundle-delivery.mjs', import.meta.url), 'utf8')
  assert.match(source, /createOrchestratorBundleDelivery\(\{/)
  assert.match(delivery, /^import \{ postLongRunningWorkerJSON \} from '\.\.\/automation\/chat-agent-long-request\.mjs'$/m)
  const post = delivery.slice(delivery.indexOf('async function postTask('))
  assert.match(post.slice(0, 1200), /if \(suffix === 'bundle'\) \{[\s\S]{0,500}await postLongRunning\(backendURL, endpoint, body\)/)
})
