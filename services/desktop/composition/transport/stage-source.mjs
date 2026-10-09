import { readFile } from 'node:fs/promises'
import { compositionSection } from '../entry/source.mjs'

const promptSections = [
  ['preparation/prepare.mjs', 'async function preparePromptForChatGPT('],
  ['preparation/queue.mjs', 'async function queuePreparedPromptForWorker('],
  ['retry/persisted.mjs', 'async function retryPersistedChatGPTPrompt('],
  ['retry/prepared.mjs', 'async function retryPreparedChatGPTPrompt('],
  ['manual/attach.mjs', 'async function attachContextToChatGPT('],
  ['submission/prepared.mjs', 'async function submitPreparedChatGPTDraft('],
  ['submission/prompt.mjs', 'async function submitPromptToChatGPT('],
  ['continuation/continue.mjs', 'function automaticChatGPTContinuationBlockReason('],
]
const pacingSections = [
  ['../../chatgpt/session/health/conversation-reads/health.mjs', '  const CHATGPT_CONVERSATION_LOAD_BACKOFF_MS =', '\n  return { chatGPTConversationReadCooldownMs,'],
  ['./pacing/runtime.mjs', '  function noteOrchestrationTaskPin(', '\n  const resume = createChatGPTRateLimitResume({'],
  ['../../chatgpt/session/health/rate-limit-resume.mjs', '  function chatAgentRateLimitDelayMs()', '\n  return { chatAgentRateLimitDelayMs,'],
  ['../../agent/scheduling/residency/worker-pacing.mjs', '  function chatAgentNavigationGapMs()', '\n  return {\n    ChatGPTRateLimitDeferral,'],
  ['../../chatgpt/transport/uploads/paste-runtime.mjs', '  async function pasteChatGPTFile(', '\n  return { pasteChatGPTFile }'],
]

async function body(file, first, last = '\n  return {') {
  const source = await readFile(new URL(file, import.meta.url), 'utf8')
  const start = source.indexOf(first)
  const end = source.lastIndexOf(last)
  if (start < 0 || end <= start) throw new Error(`Desktop transport stage source missing: ${file}`)
  return source.slice(start, end).replace(/^  /gm, '').trim()
}

// The cross-domain source view remains tied to the actual staged composition.
export async function expandDesktopChatGPTTransportStageSource(main) {
  const stage = await readFile(new URL('./stage/runtime.mjs', import.meta.url), 'utf8')
  const facade = await readFile(new URL('./stage/index.mjs', import.meta.url), 'utf8')
  const preparation = await readFile(new URL('./preparation/runtime.mjs', import.meta.url), 'utf8')
  const pacing = await readFile(new URL('./pacing/runtime.mjs', import.meta.url), 'utf8')
  const dispatch = await readFile(new URL('../../chatgpt/transport/requests/wiring/desktop.mjs', import.meta.url), 'utf8')
  const { start, end } = compositionSection(main, 'chatgpt-transport')
  const order = ['createChatGPTConversationSettlement(', 'createDesktopRequestPreparation(',
    'createDesktopChatGPTAccount(', 'createOwnedChatGPTConversationReload(',
    'createChatGPTComposerTarget(', 'createDesktopChatGPTPacing(', 'createDesktopPromptDispatch(']
  const stageBody = stage.slice(stage.indexOf('export function createDesktopChatGPTTransportStage('))
  const positions = order.map((name) => stageBody.indexOf(name))
  if (start < 0 || end <= start || positions.some((at) => at < 0)
      || positions.some((at, i) => i > 0 && at <= positions[i - 1])
      || !main.includes("compose(ctx, 'chatgpt-transport', createDesktopChatGPTTransportStage, {")
      || !facade.includes("from './runtime.mjs'")
      || !preparation.includes('createChatInputPreparation({')
      || !preparation.includes('createChatGPTRendererStability({')
      || !pacing.includes('createChatGPTRateLimitResume({')
      || !pacing.includes('createWorkerPacing({')
      || !pacing.includes('createChatGPTFileUpload({')
      || !dispatch.includes('createChatGPTDraftSubmission({')
      || !dispatch.includes('createChatGPTPromptTransport({')) {
    throw new Error('Desktop ChatGPT transport stage composition missing')
  }
  const parts = [
    await body('../../chatgpt/session/ownership/conversation-settlement.mjs', '  async function waitForConcreteChatGPTConversation('),
    await body('./preparation/runtime.mjs', '  async function persistChatArtifact(', '\n  const attachments = createChatGPTAttachmentTools({'),
    await body('../../chatgpt/transport/requests/preparation/input.mjs', '  async function materializeChatInput(', '\n  return { materializeChatInput,'),
    await body('../../chatgpt/session/views/renderer-stability.mjs', '  async function waitForChatGPTSurfaceReady(', '\n  return { executeChatGPTDOMScript, waitForChatGPTSurfaceReady }'),
    await body('../../chatgpt/account/wiring/desktop.mjs', '  let accountOperation = Promise.resolve()', '\n  return createChatGPTAccountOperations({'),
    await body('../../chatgpt/session/views/reload.mjs', '  async function reloadOwnedChatGPTConversation(', '\n  return { reloadOwnedChatGPTConversation }'),
    await body('../../chatgpt/transport/requests/composer/target.mjs', '  async function targetChatGPTComposer(', '\n  return { targetChatGPTComposer }'),
  ]
  for (const section of pacingSections) parts.push(await body(...section))
  parts.push(await body('../../chatgpt/transport/requests/wiring/desktop.mjs', '  async function stepChatGPTReasoningEffortToward(', '\n  const { submitChatGPTDraft,'))
  parts.push(await body('../../chatgpt/transport/requests/submission/draft.mjs', '  async function submitChatGPTDraft(', '\n  return { submitChatGPTDraft,'))
  for (const [file, signature] of promptSections) {
    parts.push(await body(`../../chatgpt/transport/requests/${file}`, `  ${signature}`))
  }
  return `${main.slice(0, start)}${parts.join('\n\n')}\n${main.slice(end)}`
}
