import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readPromptTransportSource } from '../../../composition/transport/prompt-source.mjs'

test('orchestrator planning survives as an exact artifact-only Worker delivery', async () => {
  const source = await readPromptTransportSource()
  const worker = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8')
  const preflight = await readFile(new URL('./preflight.mjs', import.meta.url), 'utf8')
  const submission = await readFile(new URL('./submission.mjs', import.meta.url), 'utf8')
  const observation = await readFile(new URL('./observation.mjs', import.meta.url), 'utf8')
  const increment = await readFile(new URL('./increment.mjs', import.meta.url), 'utf8')
  const dispatcher = await readFile(new URL('../../scheduling/execution/dispatcher.mjs', import.meta.url), 'utf8')
  assert.match(source, /createOrchestratorPlanWorker\(\{/)
  assert.match(preflight, /harness\.orchestrator-planning\/v1/)
  assert.match(observation, /pollWorkerExpectedDownload\(expected,/)
  assert.match(observation, /'orchestrator-download', script\), chatGPTExpectedDownloadScript\)/)
  assert.match(observation, /chatGPTResponseCompletionScript\(flow\.assistantBaseline\)/)
  assert.match(submission, /target\.reasoningEffort = normalizeChatGPTReasoningEffort\(payload\.reasoning_effort\)/)
  assert.match(submission, /reasoningEffort: normalizeChatGPTReasoningEffort\(payload\.reasoning_effort\)/)
  // Initial submission, artifact re-request and Partial context increment.
  assert.equal(([submission, observation, increment].join('\n').match(/requireReasoningEffort: false/g) || []).length, 3)
  // One import path for the live download, a retained artifact and both
  // deliveries, so nothing reaches the backend through a weaker check.
  assert.match(observation, /importOrchestratorPlanArtifact\(sessionId, requestId, delivery, outcome\.value\)/)
  const dispatch = source.slice(source.indexOf('async function importOrchestratorPlanArtifact('), source.indexOf('\n// A retained artifact is best-effort'))
  assert.match(dispatch, /delivery === 'bundle'/)
  assert.match(dispatch, /importOrchestratorWorkerPlanBundle\(sessionId, requestId, bytes\)/)
  // The legacy artifact still goes through the strict JSON parser.
  assert.match(dispatch, /parseOrchestratorPlanProposal\(text\)/)
  const parser = source.slice(source.indexOf('function parseOrchestratorPlanProposal('), source.indexOf('\nfunction orchestratorPlanResult('))
  assert.match(parser, /harness\.orchestrator-plan\/v1/)
  assert.match(parser, /Array\.isArray\(proposal\.tasks\)/)
  assert.match(submission, /checkpointChatAgentTask\(task\.task_id, owner/)
  assert.match(increment, /checkpointChatAgentTask\(task\.task_id, owner/)
  assert.match(preflight, /canonicalChatGPTConversationURL\(payload\.conversation_url/)
  assert.match(submission, /orchestrator-checkpoint/)
  assert.match(worker, /flow\.terminalCleanup \|\| Number\(task\.attempt/)
  assert.doesNotMatch([worker, preflight, submission, observation, increment].join('\n'), /textContent|innerText|chatGPTVisibleActivityScript/)

  const downloadSource = await readFile(new URL('../../../chatgpt/downloads/orchestrator-plan-downloads.mjs', import.meta.url), 'utf8')
  const downloadStart = downloadSource.indexOf('function registerChatGPTOrchestratorPlanDownload(')
  assert.notEqual(downloadStart, -1)
  const download = downloadSource.slice(downloadStart)
  assert.match(download, /MAX_ORCHESTRATOR_PLAN_BYTES/)
  // Strict UTF-8 validation moved to the import dispatch with the rest of the
  // legacy JSON handling; the download layer now carries raw bytes so a bundle
  // can be uploaded verbatim.
  const dispatchDecode = source.slice(source.indexOf('async function importOrchestratorPlanArtifact('), source.indexOf('\n// A retained artifact is best-effort'))
  assert.match(dispatchDecode, /new TextDecoder\('utf-8', \{ fatal: true \}\)/)
  assert.match(download, /\^whx_orchestrator_plan_cat_/)
  assert.match(source, /createChatAgentExecution\(\{/)
  assert.match(dispatcher, /case 'ORCHESTRATOR_PLAN': return executeChatAgentOrchestratorPlan/)
})

test('a plan delivered between attempts is retained instead of cancelled', async () => {
  const source = await readFile(new URL('../../../chatgpt/downloads/orchestrator-plan-downloads.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function registerChatGPTOrchestratorPlanDownload(')
  const download = source.slice(start)
  // Measured: four planning requests reached attempt 7/8 with zero plans
  // imported, because ChatGPT delivers when it finishes rather than while a
  // lease is open, and an unarmed artifact was cancelled.
  assert.match(download, /return retainChatGPTOrchestratorPlanDownload\(item, filename\)/)
  assert.doesNotMatch(download.slice(0, download.indexOf('const total')), /item\.cancel\(\)/)

  const retain = source.slice(source.indexOf('function retainChatGPTOrchestratorPlanDownload('), source.indexOf('\n// Claim a retained artifact'))
  // The filename carries its own task id, so a retained plan can only be
  // claimed by the attempt that owns it.
  assert.match(retain, /whx_orchestrator_plan_\(cat_\[a-f0-9\]\{20\}\)\\\.json/)
  assert.match(retain, /MAX_ORCHESTRATOR_PLAN_BYTES/)
  assert.match(retain, /chatGPTOrchestratorPlanInbox\.set\(filename/)
})

test('a retained plan is imported before spending another provider request', async () => {
  const worker = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8')
  const submission = await readFile(new URL('./submission.mjs', import.meta.url), 'utf8')
  const retainIndex = worker.indexOf('takeRetainedChatGPTOrchestratorPlan(filename)')
  const submitIndex = worker.indexOf('submitOrResumeOrchestratorPlan(flow, deps)')
  assert.ok(retainIndex > -1, 'the attempt must look for a retained plan')
  assert.ok(retainIndex < submitIndex, 'the retained plan must be claimed before any new submission')
  assert.match(submission, /targetChatGPTComposer\(key, homeURL, false, entry\)/)

  // The inbox is bounded so a retained artifact cannot accumulate forever.
  const downloads = await readFile(new URL('../../../chatgpt/downloads/orchestrator-plan-downloads.mjs', import.meta.url), 'utf8')
  assert.match(downloads, /const ORCHESTRATOR_PLAN_INBOX_MAX = \d+/)
  assert.match(downloads, /const ORCHESTRATOR_PLAN_INBOX_TTL_MS/)
  assert.match(downloads, /function pruneChatGPTOrchestratorPlanInbox\(/)
})

test('a plan still being produced at the lease deadline is observed, not failed', async () => {
  const source = await readPromptTransportSource()
  const worker = await readFile(new URL('./observation.mjs', import.meta.url), 'utf8')
  // An 8-minute lease is shorter than a large DAG takes to plan. Throwing at
  // the deadline charged an attempt for a page that was visibly still working,
  // and sent the next lease to reload a conversation mid-generation.
  assert.match(worker, /if \(completion\?\.thinking === true\) thinkingObservedAt = Date\.now\(\)/)
  assert.match(source, /generatingGraceMs: ORCHESTRATOR_PLAN_GENERATING_GRACE_MS/)
  assert.match(worker, /thinkingObservedAt && Date\.now\(\) - thinkingObservedAt < generatingGraceMs/)
  const observeIndex = worker.indexOf('thinkingObservedAt && Date.now() - thinkingObservedAt < generatingGraceMs')
  const throwIndex = worker.indexOf('before the orchestrator planning timeout')
  assert.ok(observeIndex < throwIndex, 'the still-generating check must precede the timeout failure')
  assert.match(worker.slice(observeIndex, throwIndex), /observation: true/)
})

test('orchestrator planning delivers the project standard response bundle', async () => {
  const source = await readPromptTransportSource()
  const preflight = await readFile(new URL('./preflight.mjs', import.meta.url), 'utf8')
  // The planning result uses the same ZIP transport and naming contract as
  // every other planner artifact instead of a bare JSON file of its own.
  const naming = source.slice(source.indexOf('function orchestratorBundleFilename('), source.indexOf('\n// A checkpoint written under the old contract'))
  assert.match(naming, /buildBundleName\('res', 'orchestrator', id\)/)
  assert.match(naming, /\^orp_\[0-9\]\{8\}T\[0-9\]\{6\}_\[0-9a-f\]\{16\}\$/)

  // A request already checkpointed under the legacy contract finishes on it.
  const delivery = source.slice(source.indexOf('function orchestratorDeliveryFor('), source.indexOf('\nasync function importOrchestratorWorkerPlanBundle('))
  assert.match(delivery, /endsWith\('\.json'\) \? 'json' : 'bundle'/)

  assert.match(preflight, /delivery === 'bundle' \? orchestratorBundleFilename\(requestId\) : orchestratorPlanFilename\(task\.task_id\)/)

  // The Desktop is transport: it uploads the archive verbatim and the backend
  // is the single place untrusted planner bytes are opened and validated.
  const uploadStart = source.indexOf('async function importOrchestratorWorkerPlanBundle(')
  const upload = source.slice(uploadStart, source.indexOf('\nasync function importOrchestratorWorkerPlan(', uploadStart))
  assert.match(upload.slice(0, 900), /orchestrator\/plans\/import-bundle/)
  assert.match(upload.slice(0, 900), /'Content-Type': 'application\/zip'/)
  assert.doesNotMatch(preflight, /JSZip|unzip|inflate/i)

  const request = await readFile(new URL('../../../agent/orchestration/chat-agent-orchestrator-request.mjs', import.meta.url), 'utf8')
  assert.match(request, /BUNDLE ONLY/)
  assert.match(request, /one UTF-8 plan\.json/)
})
