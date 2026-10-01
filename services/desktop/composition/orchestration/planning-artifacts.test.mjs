import { readTaskExecutionSource } from '../workers/task-execution-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('background planner continuations use hidden Workers and cannot focus or rebind a Supervisor', async () => {
  const source = await readTaskExecutionSource()
  const queueStart = source.indexOf('async function queuePreparedPromptForWorker(')
  const queueEnd = source.indexOf('\nasync function retryPersistedChatGPTPrompt', queueStart)
  const queued = source.slice(queueStart, queueEnd)
  assert.match(queued, /enqueueChatAgentTask\('BOT_WRITE'/)
  assert.match(queued, /operation: 'PREPARE_PROMPT'/)
  assert.doesNotMatch(queued, /ensureChatGPTView|withChatGPTSupervisorTransport|\.focus\(/)

  const promptIPC = await readFile(new URL('../../chatgpt/transport/requests/ipc/prompt.mjs', import.meta.url), 'utf8')
  const handlerStart = promptIPC.indexOf("ipcMain.handle('wharness:chatgpt:prepare-prompt'")
  const handler = promptIPC.slice(handlerStart, promptIPC.indexOf('\n  })', handlerStart))
  assert.match(source, /registerChatGPTPromptIPC\(\{/)
  assert.match(handler, /request\?\.background === true[\s\S]*queuePreparedPromptForWorker\(request\)/)

  const writeStart = source.indexOf('async function executeChatAgentWrite(')
  const write = source.slice(writeStart, source.indexOf('\nasync function enqueueOrganizeFromTitle', writeStart))
  assert.match(write, /payload\.operation === 'PREPARE_PROMPT'/)
  assert.match(write, /preparePromptForChatGPT\(safeRequest, entry, \{ pacedWorker \}\)/)

  const executionStart = source.indexOf('async function executeChatAgentTask(')
  const execution = source.slice(executionStart, source.indexOf('\n  switch \(task\.type\)', executionStart))
  assert.match(execution, /!conversationURL && !isTrustedChatGPTOrigin[\s\S]*CHATGPT_URL/)

  const submitStart = source.indexOf('async function submitChatGPTDraft(')
  const submit = source.slice(submitStart, source.indexOf('\nasync function preparePromptForChatGPT', submitStart))
  assert.doesNotMatch(submit, /dispatchChatGPTSubmit|\.focus\(/)
  assert.match(submit, /if \(!clicked\) throw new Error\('ChatGPT send button is unavailable'\)/)
})

test('a failed prompt delivery remains retryable without asking the planner for a new prompt', async () => {
  const source = await readTaskExecutionSource()
  const promptIPC = await readFile(new URL('../../chatgpt/transport/requests/ipc/prompt.mjs', import.meta.url), 'utf8')
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const retryStart = source.indexOf('async function retryPreparedChatGPTPrompt(request, entryOverride = undefined)')
  const retryEnd = source.indexOf('\nasync function attachContextToChatGPT', retryStart)
  assert.match(source.slice(prepareStart, prepareEnd), /retryableChatGPTPrompts\.set\(key, \{ request, preparedAt: Date\.now\(\) \}\)/)
  assert.match(source.slice(retryStart, retryEnd), /return preparePromptForChatGPT\(retryable\.request, entryOverride\)/)
  assert.match(promptIPC, /wharness:chatgpt:retry-prepared-prompt/)
  const [transportExports, requestExports] = await Promise.all([
    readFile(new URL('../../chatgpt/transport/index.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../chatgpt/transport/requests/index.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(source, /from '\.\/chatgpt\/transport\/index\.mjs'/)
  assert.match(transportExports, /requestPreparationTimer[\s\S]*from '\.\/requests\/index\.mjs'/)
  assert.match(requestExports, /requestPreparationTimer[\s\S]*from '\.\/chatgpt-request-preparation\.mjs'/)
  assert.doesNotMatch(source, /from '\.\/remote-input(?:-timeout)?\.mjs'/)
})


test('bundle fallback snapshots assistant-turn baseline before each planner submit', async () => {
  const source = await readTaskExecutionSource()
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  const baseline = prepare.indexOf('await chatGPTAssistantTurnCount(target.wc)')
  const submit = prepare.indexOf('await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)')
  const arm = prepare.indexOf('armExpectedChatGPTBundle(key, requestId, assistantBaseline, bootstrap, [], directPrompt, request?.sessionId, expectedFilename, input.requestMetadata)')
  assert.ok(baseline >= 0 && arm > baseline && submit > arm)

  const repairStart = source.indexOf('async function submitPromptToChatGPT')
  const repairEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', repairStart)
  const repair = source.slice(repairStart, repairEnd)
  assert.match(repair, /const assistantBaseline = await chatGPTAssistantTurnCount\(target\.wc\)/)
  assert.match(repair, /armExpectedChatGPTBundle\(key, requestId, assistantBaseline, bundled\.bootstrap, \[\], text, sessionId, expectedFilename, requestMetadata\)/)
})
