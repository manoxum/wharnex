import { readTaskExecutionSource } from './task-execution-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('conversation load failures across threads cool Worker conversation reads down', async () => {
  const source = await readTaskExecutionSource()
  assert.match(source, /chatGPTConversationReadFailures\.size >= 2 \|\| chatGPTConversationReadStreak > 0/)
  const execute = source.slice(source.indexOf('async function executeChatAgentTask(task, { worker, owner, entry: ephemeralEntry })'))
  assert.match(execute.slice(0, 1500), /chatGPTConversationReadGateMs\(task\.task_id\)[\s\S]{0,200}observation: true/)
  // Only a rendered conversation clears its backoff; "no failure seen" does not.
  const recover = source.slice(source.indexOf('async function recoverChatGPTConversationLoadFailure('))
  assert.match(recover.slice(0, 900), /if \(!result\?\.loaded\) return\n\s+chatGPTConversationLoadFailures\.delete\(conversation\)\n\s+if \(chatGPTConversationID\(wc\.getURL\(\)\)\) noteChatGPTConversationReadHealthy\(\)/)
})

test('after a read cooldown one task probes alone and a failed probe doubles the cooldown', async () => {
  const source = await readTaskExecutionSource()
  const gate = source.slice(source.indexOf('function chatGPTConversationReadGateMs('))
  assert.match(gate.slice(0, 700), /if \(cooldown > 0 \|\| chatGPTConversationReadStreak === 0\) return cooldown/)
  assert.match(gate.slice(0, 700), /chatGPTConversationReadProbe\.taskId !== taskId\) return CHATGPT_CONVERSATION_READ_PROBE_WAIT_MS/)
  assert.match(source, /CHATGPT_CONVERSATION_READ_COOLDOWN_MS \* 2 \*\* \(chatGPTConversationReadStreak - 1\), CHATGPT_CONVERSATION_READ_COOLDOWN_MAX_MS/)
  assert.match(source, /releaseChatGPTConversationReadProbe\(task\.task_id\)/)
})

test('a hidden Worker whose conversation failed to load is parked off it after the attempt', async () => {
  const source = await readTaskExecutionSource()
  const recover = source.slice(source.indexOf('async function recoverChatGPTConversationLoadFailure('))
  assert.match(recover.slice(0, recover.indexOf('throw new ChatGPTConversationUnavailable')), /if \(entry\.role === 'worker'\) entry\.parkAfterLoadFailure = true/)
  const park = source.slice(source.indexOf('function parkChatGPTWorkerAfterLoadFailure('))
  assert.match(park.slice(0, 900), /entry\.interactionWindowId/)
  assert.match(park.slice(0, 900), /chatAgentResidency\.releaseResidentLane\(entry\.slotId\)/)
  assert.match(park.slice(0, 900), /wc\.loadURL\('about:blank'\)/)
  assert.match(source, /\.finally\(\(\) => \{\n\s+parkChatGPTWorkerAfterLoadFailure\(workerEntryForIndex\(context\?\.worker\)\)/)
  // The ephemeral utility Worker parks and releases the same way.
  const ephemeral = source.slice(source.indexOf('async function executeEphemeralWorkerTask('))
  assert.match(ephemeral.slice(0, 2500), /parkChatGPTWorkerAfterLoadFailure\(kept\.entry\)/)
})

test('a Worker pinned to a task is published as occupied by it between rounds', async () => {
  const source = await readFile(new URL('../../agent/supervision/runtime-snapshot.mjs', import.meta.url), 'utf8')
  assert.match(source, /const pinnedTaskId = orchestrationTaskPins\.taskId\(entry\.slotId\)/)
  assert.match(source, /occupied: Boolean\(runtime\.task \|\| chatAgentKeepFlowingActive\(worker\) \|\| pinnedTaskId\),\n\s+pinned_task_id: pinnedTaskId,/)
})

test('ephemeral utility Workers are published and can be followed while their task runs', async () => {
  const source = await readTaskExecutionSource()
  const snapshot = await readFile(new URL('../../agent/supervision/runtime-snapshot.mjs', import.meta.url), 'utf8')
  const interaction = await readFile(new URL('../../agent/supervision/surface/worker-interaction.mjs', import.meta.url), 'utf8')
  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const ephemeralConfig = await readFile(new URL('../../agent/automation/artifact-workers/ephemeral-config.mjs', import.meta.url), 'utf8')
  const wiring = await readFile(new URL('../../agent/scheduling/wiring/desktop.mjs', import.meta.url), 'utf8')
  assert.match(ephemeralConfig, /const EPHEMERAL_AGENT_ID = \/\^\(ephemeral\|translator\)-cat_\[a-f0-9\]\{20\}\$\//)
  assert.match(interaction, /if \(!\/\^worker-\[1-9\]\[0-9\]\?\$\/\.test\(id\) && !isEphemeralAgentID\(id\)\)/)
  assert.match(main, /getEphemeralAgentID: \(\) => EPHEMERAL_AGENT_ID/)
  assert.match(wiring, /isEphemeralAgentID: \(id\) => d\.getEphemeralAgentID\(\)\.test\(id\)/)
  assert.match(snapshot, /const agents = \[\.\.\.supervisors, \.\.\.workers, \.\.\.ephemeral\]/)
  assert.match(snapshot, /label: `Worker efémero · \$\{EPHEMERAL_WORKER_LABELS\[task\?\.type\] \|\| 'Utilitário'\}`/)
})
