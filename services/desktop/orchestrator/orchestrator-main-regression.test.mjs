import { readTaskExecutionSource } from '../composition/workers/task-execution-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('expected bundle supervision is armed only around submissions that can leave stale state', async () => {
  const source = await readTaskExecutionSource()
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const prepareEnd = source.indexOf('\nasync function retryPersistedChatGPTPrompt', prepareStart)
  assert.notEqual(prepareStart, -1)
  assert.notEqual(prepareEnd, -1)
  const prepare = source.slice(prepareStart, prepareEnd)
  const submitCount = (prepare.match(/await submitChatGPTDraft\(key, target\.entry, target\.conversationUrl, target, \{ rateLimitExempt: !pacedWorker, requireReasoningEffort: !orchestratorTask \}\)/g) || []).length
  const disarmCount = (prepare.match(/disarmExpectedChatGPTBundle\(key, requestId\)/g) || []).length
  assert.equal(submitCount, 1, 'the mandatory ZIP autoSubmit path calls submitChatGPTDraft once')
  // One disarm for a failed submitChatGPTDraft, one when the post-submit
  // Orchestrator affinity callback refuses the observed conversation, and one
  // for a failed durable AWAIT_RESPONSE enqueue. None of those paths may leave
  // a live in-memory expectation that could later trigger a resend.
  assert.equal(disarmCount, 3, 'submit, affinity binding and durable follow-up failures all disarm the bundle armed before dispatch')

  const preparedStart = source.indexOf('async function submitPreparedChatGPTDraft(')
  const preparedEnd = source.indexOf('\nasync function submitPromptToChatGPT', preparedStart)
  const prepared = source.slice(preparedStart, preparedEnd)
  const preparedSubmit = prepared.indexOf('await submitChatGPTDraft(key, entry, prepared.conversationUrl || entry.affinity.boundURL)')
  const preparedArm = prepared.indexOf('armExpectedChatGPTBundle(key, prepared.requestId')
  assert.ok(preparedSubmit >= 0 && preparedArm > preparedSubmit, 'manual prepared submit arms supervision only after submit confirmation')
  assert.match(prepared, /disarmExpectedChatGPTBundle\(key, prepared\.requestId\)/)

  const repairStart = source.indexOf('async function submitPromptToChatGPT')
  const repairEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', repairStart)
  const repair = source.slice(repairStart, repairEnd)
  const repairSubmit = repair.indexOf('await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)')
  const repairArm = repair.indexOf('armExpectedChatGPTBundle(key, requestId')
  assert.ok(repairSubmit >= 0 && repairArm > repairSubmit, 'repair submission arms supervision only after submit confirmation')
})

test('an Orchestrator execution claim does not open its conversation before the executor needs it', async () => {
  const source = await readTaskExecutionSource()
  const execute = source.slice(source.indexOf('async function executeChatAgentTask(task, { worker, owner, entry: ephemeralEntry })'))
  assert.match(execute, /const executorNavigates = task\.type === 'ORCHESTRATOR_EXECUTE'/)
  // It never bootstraps a blank page on the home surface either: the driver
  // goes straight to the task's own conversation.
  assert.match(execute, /if \(executorNavigates\) \{[\s\S]{0,400}settleAssignment\(entry\.slotId, assigned\.assignment\.epoch, assigned\.lane\)[\s\S]{0,120}\} else if \(conversationURL && !sameConversationURL/)
  // Main delegates definitive navigation to the focused Orchestrator guard.
  assert.match(source, /createOrchestratorConversationGuard\(\{[\s\S]{0,500}load: \(key, entry, url\) => loadOwnedChatGPTURL\(key, entry, url, 'orchestrator-task-affinity'\)/)
  const adopt = source.slice(source.indexOf('async function adoptOrchestratorRequest('))
  assert.match(adopt.slice(0, 320), /await orchestratorConversationGuard\.ensureConversation\(key, entry, conversationURL\)/)
  assert.match(source, /ensureConversation: orchestratorConversationGuard\.ensureConversation,/)
})

test('Orchestrator submission binds affinity before response followups and fails closed on drift', async () => {
  const source = await readTaskExecutionSource()
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const prepareEnd = source.indexOf('\nasync function queuePreparedPromptForWorker', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  const observed = prepare.indexOf('conversationUrl = await waitForSubmittedChatGPTConversation')
  const bind = prepare.indexOf("typeof request?.onSubmittedConversation === 'function'")
  const followups = prepare.indexOf('const mainRequestTask = await enqueueChatAgentFollowups')
  assert.ok(observed >= 0 && observed < bind && bind < followups, 'durable affinity must be confirmed before response supervision is queued')
  assert.match(prepare, /disarmExpectedChatGPTBundle\(key, requestId\)[\s\S]{0,220}throw error/)

  const sendStart = source.indexOf('async function sendOrchestratorMainRequest(')
  const send = source.slice(sendStart, source.indexOf('\nasync function chatAgentLifecycleBlocked', sendStart))
  assert.match(send, /\.\.\.orchestratorConversationGuard\.submissionHooks\(conversationURL, bindSubmittedConversation\)/)

  const guard = await readFile(new URL('../agent/orchestration/chat-agent-orchestrator-execution.mjs', import.meta.url), 'utf8')
  assert.match(guard, /onTargetConversation\(observedURL\)[\s\S]{0,500}request was not submitted/)
  assert.match(guard, /async onSubmittedConversation\(observedURL\)[\s\S]{0,900}bindSubmittedConversation\(observed\)/)
  assert.match(guard, /execution ended without resending/)
})

test('Orchestrator conversation guard loads the definitive URL and rejects any divergence', async () => {
  const { createOrchestratorConversationGuard } = await import('../agent/orchestration/chat-agent-orchestrator-execution.mjs')
  let current = 'https://chatgpt.com/c/other'
  const events = []
  const guard = createOrchestratorConversationGuard({
    conversationURL: (value) => /^https:\/\/chatgpt\.com\/c\/[^/]+$/.test(String(value || '')) ? String(value) : '',
    currentURL: () => current,
    pace: async () => events.push('pace'),
    load: async (_key, _entry, url) => { events.push(['load', url]); current = url },
    waitReady: async () => events.push('ready'),
  })
  const definitive = 'https://chatgpt.com/c/task'
  assert.equal(await guard.ensureConversation('otk', {}, definitive), definitive)
  assert.deepEqual(events, ['pace', ['load', definitive], 'ready'])

  const hooks = guard.submissionHooks(definitive, async (observed) => observed)
  assert.throws(() => hooks.onTargetConversation('https://chatgpt.com/c/other'), /not submitted/)
  await assert.rejects(hooks.onSubmittedConversation('https://chatgpt.com/c/other'), /without resending/)

  const conflictingBackend = guard.submissionHooks(definitive, async () => 'https://chatgpt.com/c/backend-other')
  await assert.rejects(conflictingBackend.onSubmittedConversation(definitive), /backend did not confirm/)
})
