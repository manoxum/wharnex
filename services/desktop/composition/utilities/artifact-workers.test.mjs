import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readTaskExecutionSource } from '../workers/task-execution-source.mjs'


test('translation worker is transport only: it uploads the engine’s bundle and returns bytes it never reads', async () => {
  const source = await readTaskExecutionSource()
  const executeStart = source.indexOf('async function executeChatAgentMarkdownTranslation(')
  const executeEnd = source.indexOf('\nasync function chatAgentLifecycleRetry', executeStart)
  const worker = source.slice(executeStart, executeEnd)
  assert.notEqual(executeStart, -1)
  assert.match(worker, /pollWorkerExpectedDownload\(expected,/)
  assert.match(worker, /'translation-download', script\), chatGPTExpectedDownloadScript\)/)
  assert.match(worker, /expected\.assistantBaseline = assistantBaseline/)
  assert.doesNotMatch(worker, /textContent|innerText|chatGPTVisibleActivityScript/)
  assert.match(worker, /expectedChatGPTTranslations\.set\(filename, expected\)/)
  assert.match(worker, /target\.reasoningEffort = 'instant'/)
  assert.ok(worker.indexOf("target.reasoningEffort = 'instant'") < worker.indexOf('await submitChatGPTDraft('))

  // Everything the provider is asked for was authored by the backend engine and
  // sealed into the request archive. The worker uploads it and submits the
  // bounded bootstrap; it composes no instruction of its own, because an
  // instruction built here could not be validated by the side that reads the
  // answer.
  assert.match(worker, /wharness\.translation-input\/v1/)
  assert.match(worker, /payload\.archive_base64/)
  assert.match(worker, /chatGPTFillComposerScript\(bootstrap\)/)
  assert.doesNotMatch(worker, /Translate the attached/)
  assert.doesNotMatch(worker, /markdownTranslationLanguageName/)

  // It returns the downloaded bytes unopened: parsing here would put the
  // protocol in two places, and only one of them wrote the request.
  assert.match(worker, /bundle_base64: outcome\.value\.toString\('base64'\)/)
  assert.doesNotMatch(worker, /markdown: outcome\.value/)

  const downloads = await readFile(new URL('../../chatgpt/downloads/utility-downloads.mjs', import.meta.url), 'utf8')
  const downloadStart = downloads.indexOf('function registerChatGPTMarkdownTranslationDownload(')
  assert.notEqual(downloadStart, -1)
  const download = downloads.slice(downloadStart)
  assert.match(download, /MAX_MARKDOWN_TRANSLATION_RESULT_BYTES/)
  assert.match(download, /expected\.resolve\(bytes\)/)
  assert.doesNotMatch(download, /new TextDecoder/)
  assert.match(download, /\^whx_translation_res_cat_\[a-f0-9\]\{20\}\\\.zip\$/)
})

test('translation borrows an idle Worker or creates a one-shot Translator', async () => {
  const source = await readTaskExecutionSource()
  const executeStart = source.indexOf('async function executeChatTranslatorTask(')
  const executeEnd = source.indexOf('\nasync function executeChatAgentTask(', executeStart)
  const execute = source.slice(executeStart, executeEnd)
  assert.notEqual(executeStart, -1)
  assert.match(execute, /task\?\.type !== 'TRANSLATE_MARKDOWN'/)
  assert.match(execute, /borrowedEntry \|\| createChatGPTWorkerView/)
  assert.match(execute, /if \(borrowedEntry\) chatAgentResidency\.releaseResidentLane/)
  assert.match(execute, /createChatGPTWorkerView\(`translator-\$\{task\.task_id\}`/)
  assert.match(execute, /finally \{[\s\S]*chatGPTWorkerEntries\.splice\(index, 1\)[\s\S]*retireChatGPTWorkerView\(entry\)/)

  const schedulerStart = source.indexOf('chatTranslatorScheduler = new ChatAgentSchedulerClient(')
  const schedulerEnd = source.indexOf('chatSupervisorScheduler = new ChatAgentSchedulerClient(', schedulerStart)
  const scheduler = source.slice(schedulerStart, schedulerEnd)
  assert.notEqual(schedulerStart, -1)
  assert.match(scheduler, /role: 'translator'/)
  assert.match(scheduler, /agentID: \(index\) => `translator-\$\{index\}`/)
  assert.match(scheduler, /maxWorkers: MAX_TRANSLATOR_SLOTS/)
  assert.match(scheduler, /idleMs: 100, taskCooldownMs: 0/)
  assert.match(source, /if \(task\.type === 'TRANSLATE_MARKDOWN'\) return executeChatTranslatorTask\(task, \{ entry \}\)/)
})


test('TODO classification worker keeps the provider exchange bundle-only', async () => {
  const source = await readTaskExecutionSource()
  const executeStart = source.indexOf('async function executeChatAgentTodoClassification(')
  const executeEnd = source.indexOf('\nasync function chatAgentLifecycleRetry', executeStart)
  const worker = source.slice(executeStart, executeEnd)
  assert.notEqual(executeStart, -1)
  assert.match(worker, /wharness\.todo-classification-input\/v1/)
  assert.match(worker, /chatGPTFillComposerScript\(bootstrap\)/)
  assert.match(worker, /chatGPTExpectedDownloadScript\(filename, assistantBaseline\)/)
  assert.match(worker, /bundle_base64: outcome\.value\.toString\('base64'\)/)
  assert.doesNotMatch(worker, /textContent|innerText|JSON\.parse\(outcome\.value/)
  assert.match(worker, /target\.reasoningEffort = 'instant'/)

  const downloads = await readFile(new URL('../../chatgpt/downloads/utility-downloads.mjs', import.meta.url), 'utf8')
  const downloadStart = downloads.indexOf('function registerChatGPTTodoClassificationDownload(')
  assert.notEqual(downloadStart, -1)
  const download = downloads.slice(downloadStart)
  assert.match(download, /MAX_TODO_CLASSIFICATION_BYTES/)
  assert.match(download, /expected\.resolve\(bytes\)/)
})

test('a detected gate suspends Workers while a Translator reports its own refused request immediately', async () => {
  const source = await readTaskExecutionSource()
  const gate = source.slice(source.indexOf('function noteChatGPTRateLimitGate('), source.indexOf('\nfunction noteChatGPTHTTPStatus('))
  assert.match(gate, /health\?\.rateLimited !== true/)
  assert.match(gate, /domGate: true/)

  // Long-running supervision paths hand the slot back as passive observations,
  // which returns the attempt. Translation is intentionally single-attempt and
  // must instead fail immediately so the UI does not wait through suspension.
  const planObservation = await readFile(new URL('../../agent/orchestration/plan/observation.mjs', import.meta.url), 'utf8')
  assert.match(source, /createOrchestratorPlanWorker\(\{/)
  const observations = planObservation.match(/if \(noteChatGPTRateLimitGate\(key, health\) && pacedWorker\) \{\s+return \{ status: 'waiting', delayMs: chatAgentRateLimitDelayMs\(\), observation: true/g) || []
  assert.ok(observations.length >= 1, `expected a passive Worker supervision path to observe, saw ${observations.length}`)
  const translationStart = source.indexOf('async function executeChatAgentMarkdownTranslation(')
  const translationEnd = source.indexOf('\nasync function executeChatAgentTodoClassification(', translationStart)
  const translation = source.slice(translationStart, translationEnd)
  assert.match(translation, /noteChatGPTRateLimitGate\(key, health\)\)[\s\S]*return \{ status: 'failed', error: 'ChatGPT rate-limit gate is active' \}/)
})

// Clicking the result-download control on every poll tick fired a real
// ChatGPT download each time a tick elapsed before will-download resolved
// the previous one, and the browser's own duplicate-name suffix on the
// later downloads was not recognised by the strict exact-filename match in
// registerChatGPTTodoClassificationDownload/registerChatGPTMarkdownTranslationDownload,
// so those extra downloads fell through to a native, undismissable OS save
// dialog - live-observed as the desktop UI becoming unresponsive.
test('TODO classification keeps its single-click guard while translation retries an unstarted download', async () => {
  const source = await readTaskExecutionSource()
  const todoStart = source.indexOf('async function executeChatAgentTodoClassification(')
  const todo = source.slice(todoStart, source.indexOf('\nasync function chatAgentLifecycleRetry', todoStart))
  assert.match(todo, /let downloadTriggered = false/)
  assert.match(todo, /if \(!downloadTriggered && Number\(completion\?\.assistantCount \|\| 0\) > assistantBaseline\)/)
  assert.match(todo, /if \(clicked\) downloadTriggered = true/)
  const translationStart = source.indexOf('async function executeChatAgentMarkdownTranslation(')
  const translation = source.slice(translationStart, todoStart)
  assert.match(translation, /expected\.assistantBaseline = assistantBaseline/)
  assert.match(translation, /pollWorkerExpectedDownload\(expected,/)
  assert.doesNotMatch(translation, /if \(!downloadTriggered && Number\(completion\?\.assistantCount/)
})

test('TODO download diagnostics never export assistant HTML or prose', async () => {
  const source = await readTaskExecutionSource()
  const dom = await readFile(new URL('../../chatgpt/dom/chatgpt-dom.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /diag-download|chatGPTDownloadDiagnosticScript/)
  assert.doesNotMatch(dom, /latestAssistantOuterHTML|\.outerHTML/)
})

test('the TODO classification and translation flows reassert composer text before submitting', async () => {
  const source = await readTaskExecutionSource()
  for (const [open, close] of [
    ['async function executeChatAgentTodoClassification(', '\nasync function chatAgentLifecycleRetry'],
    ['async function executeChatAgentMarkdownTranslation(', '\nasync function executeChatAgentTodoClassification'],
  ]) {
    const start = source.indexOf(open)
    assert.notEqual(start, -1, open)
    const fn = source.slice(start, source.indexOf(close, start))
    const fillCount = (fn.match(/chatGPTFillComposerScript\(bootstrap\)/g) || []).length
    assert.equal(fillCount, 2, `${open} must fill the composer once and reassert it once before submit`)
    const refillIndex = fn.lastIndexOf('chatGPTFillComposerScript(bootstrap)')
    const submitIndex = fn.indexOf('submitChatGPTDraft(')
    assert.ok(refillIndex < submitIndex, `${open} must reassert composer text before submitting`)
  }
})
