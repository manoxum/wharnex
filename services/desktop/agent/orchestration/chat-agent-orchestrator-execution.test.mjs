import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { executeOrchestratorExecution } from './chat-agent-orchestrator-execution.mjs'

const REQUEST = {
  task: { status: 'DOING', project_path: '/project', title: 'Task' }, run: { id: 'run-1' }, agent_session_id: 'ses-agent',
  request_id: 'req_20260927T170000_0123456789abcdef', prompt: 'Backend-authored prompt',
  expected_filename: 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip',
  chat_id: 'otk-abc', reasoning_effort: 'high', agent_state: 'awaiting_plan',
}
const TASK = { task_id: 'cat_0123456789abcdef0123', chat_id: 'otk_abc', session_id: 'ses-owner' }
const PAYLOAD = { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc' }
const entry = { view: { webContents: { getURL: () => 'https://chatgpt.com/' } } }

function affinityError(message) {
  return Object.assign(new Error(message), { orchestratorConversationMismatch: true })
}

async function drive({ start = REQUEST, supervision = { state: 'none' }, payload = PAYLOAD, adopt = false,
  stored = '', observed = '', ensureError = undefined, bindError = '', startResponse = undefined } = {}) {
  const previousFetch = globalThis.fetch
  const calls = []
  const actions = []
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push({ url: String(url), body })
    if (String(url).endsWith('/worker-start')) return startResponse ? startResponse() : { ok: true, json: async () => start }
    actions.push(['bind', body.conversation_url])
    if (bindError) {
      return { ok: false, status: 409, json: async () => ({ error: { message: bindError } }) }
    }
    return { ok: true, json: async () => ({ conversation_url: stored || body.conversation_url }) }
  }
  const runtime = {
    baseURL: 'http://127.0.0.1:6969', homeURL: 'https://chatgpt.com/',
    pace: async () => actions.push('pace'), rateLimitDelay: () => 0,
    needsNavigation: (_entry, url) => url !== 'https://chatgpt.com/',
    conversationURL: (value) => value || '',
    ensureConversation: async (_key, _entry, url) => {
      actions.push(['ensure', url])
      if (ensureError) throw ensureError
      return url
    },
    checkpoint: async (_id, _owner, value) => actions.push(['checkpoint', value]),
    supervision: async () => supervision,
    adopt: async (_key, _entry, _current, url) => { actions.push(['adopt', url]); return adopt },
    sendMainRequest: async (_key, _entry, current, url, bindSubmittedConversation) => {
      actions.push(['send', current.request_id, url])
      const submittedURL = observed || url || 'https://chatgpt.com/c/new'
      const boundURL = await bindSubmittedConversation(submittedURL)
      // Followups only exist after durable affinity binding succeeds.
      actions.push(['followups', boundURL])
      return { conversationUrl: boundURL }
    },
  }
  try {
    const result = await executeOrchestratorExecution(TASK, entry, 'otk_abc', payload, 'worker-1', runtime)
    return { result, calls, actions }
  } finally {
    globalThis.fetch = previousFetch
  }
}

test('the first submit binds its observed conversation before followups and checkpointing', async () => {
  const { result, calls, actions } = await drive()
  assert.equal(result.status, 'waiting')
  assert.equal(result.observation, true)
  assert.deepEqual(actions.find((item) => item[0] === 'send'), ['send', REQUEST.request_id, ''])
  assert.match(calls[1].url, /worker-conversation$/)
  assert.equal(calls[1].body.conversation_url, 'https://chatgpt.com/c/new')
  const bindIndex = actions.findIndex((item) => item[0] === 'bind')
  const followupIndex = actions.findIndex((item) => item[0] === 'followups')
  const checkpointIndex = actions.findIndex((item) => item[0] === 'checkpoint')
  assert.ok(bindIndex >= 0 && bindIndex < followupIndex && followupIndex < checkpointIndex)
  assert.equal(actions[checkpointIndex][1].conversation_url, 'https://chatgpt.com/c/new')
})

test('a bound task loads only its definitive backend conversation before preparing a request', async () => {
  const definitive = 'https://chatgpt.com/c/task'
  const { actions } = await drive({ start: { ...REQUEST, conversation_url: definitive } })
  assert.deepEqual(actions[0], ['ensure', definitive])
  assert.deepEqual(actions.find((item) => item[0] === 'send'), ['send', REQUEST.request_id, definitive])
  assert.equal(actions.includes('pace'), false)
  assert.equal(actions.some((item) => Array.isArray(item) && item[1] === 'https://chatgpt.com/'), false)
})

test('restart reclaim adopts the same durable task conversation even with a stale checkpoint URL', async () => {
  const definitive = 'https://chatgpt.com/c/definitive'
  const payload = {
    ...PAYLOAD,
    active_request_id: REQUEST.request_id,
    conversation_url: 'https://chatgpt.com/c/stale-checkpoint',
    assistant_baseline: 4,
  }
  const reclaimed = await drive({ start: { ...REQUEST, conversation_url: definitive }, payload, adopt: true })
  assert.deepEqual(reclaimed.actions[0], ['ensure', definitive])
  assert.deepEqual(reclaimed.actions.find((item) => item[0] === 'adopt'), ['adopt', definitive])
  assert.equal(reclaimed.actions.some((item) => item[0] === 'send'), false)
  assert.equal(reclaimed.result.observation, true)
})

test('surface drift fails closed before submit', async () => {
  const definitive = 'https://chatgpt.com/c/task'
  const drift = affinityError(`expected ${definitive}, observed https://chatgpt.com/c/other`)
  const { result, actions } = await drive({ start: { ...REQUEST, conversation_url: definitive }, ensureError: drift })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /observed/)
  assert.equal(actions.filter((item) => item[0] === 'send').length, 0)
})

test('post-submit URL drift fails closed without binding, followups, checkpoint or second submit', async () => {
  const definitive = 'https://chatgpt.com/c/task'
  const { result, actions, calls } = await drive({
    start: { ...REQUEST, conversation_url: definitive },
    observed: 'https://chatgpt.com/c/other',
  })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /changed|mudou|conversation/i)
  assert.equal(actions.filter((item) => item[0] === 'send').length, 1)
  assert.equal(actions.some((item) => item[0] === 'bind'), false)
  assert.equal(actions.some((item) => item[0] === 'followups'), false)
  assert.equal(actions.some((item) => item[0] === 'checkpoint'), false)
  assert.equal(calls.length, 1, 'only worker-start may reach the backend when observed URL already drifted')
})

test('a backend affinity disagreement after first submit fails closed before any continuation is scheduled', async () => {
  const { result, actions } = await drive({ stored: 'https://chatgpt.com/c/different' })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /backend reported a different/i)
  assert.equal(actions.filter((item) => item[0] === 'send').length, 1)
  assert.equal(actions.filter((item) => item[0] === 'bind').length, 1)
  assert.equal(actions.some((item) => item[0] === 'followups'), false)
  assert.equal(actions.some((item) => item[0] === 'checkpoint'), false)
})

test('backend rejection is terminal for the execution task and never retries submit in the same lease', async () => {
  const { result, actions } = await drive({ bindError: 'task is already bound to another conversation' })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /backend rejected/i)
  assert.equal(actions.filter((item) => item[0] === 'send').length, 1)
  assert.equal(actions.some((item) => item[0] === 'followups'), false)
})

test('a request the agentic supervision owns or delivered is only observed', async () => {
  for (const state of ['active', 'delivered']) {
    const { result, actions } = await drive({ supervision: { state } })
    assert.equal(result.status, 'waiting')
    assert.equal(result.observation, true)
    assert.equal(actions.some((item) => item[0] === 'send'), false)
    assert.equal(actions.some((item) => item[0] === 'ensure'), false)
  }
})

test('stalled supervision is answered by resending the request in the same conversation, then ends the run', async () => {
  const ended = { state: 'ended', error: 'ChatGPT deixou de dar sinal estrutural' }
  const first = await drive({
    start: { ...REQUEST, conversation_url: 'https://chatgpt.com/c/task' },
    supervision: ended,
    payload: { ...PAYLOAD, active_request_id: REQUEST.request_id, conversation_url: 'https://chatgpt.com/c/task' },
    adopt: true,
  })
  // A resend never adopts: it sends the same request again in the same conversation.
  assert.equal(first.actions.some((item) => item[0] === 'adopt'), false)
  assert.deepEqual(first.actions.find((item) => item[0] === 'send'), ['send', REQUEST.request_id, 'https://chatgpt.com/c/task'])
  assert.equal(first.actions.find((item) => item[0] === 'checkpoint')[1].resend_count, 1)
  const second = await drive({ supervision: ended, payload: { ...PAYLOAD, resent_request_id: REQUEST.request_id, resend_count: 1 } })
  assert.equal(second.actions.find((item) => item[0] === 'checkpoint')[1].resend_count, 2)
  const exhausted = await drive({ supervision: ended, payload: { ...PAYLOAD, resent_request_id: REQUEST.request_id, resend_count: 2 } })
  assert.equal(exhausted.result.status, 'failed')
  assert.match(exhausted.result.error, /sinal estrutural/)
  // A new request starts its own resend budget.
  const next = await drive({ supervision: ended, payload: { ...PAYLOAD, resent_request_id: 'req_other', resend_count: 2 } })
  assert.equal(next.result.status, 'waiting')
})

test('a settled task ends the driver and an idle Agent is observed for free', async () => {
  assert.equal((await drive({ start: { task: { status: 'REVIEW' } } })).result.status, 'done')
  const idle = await drive({ start: { ...REQUEST, request_id: '', agent_state: 'executing' } })
  assert.equal(idle.result.status, 'waiting')
  assert.equal(idle.result.observation, true)
  assert.match(idle.result.error, /Agent state executing/)
  // A verified candidate the self-evolution lock refused says why it waits.
  const parked = await drive({ start: { ...REQUEST, request_id: '', agent_state: 'verified', agent_failure_kind: 'self_evolution_transaction_busy' } })
  assert.equal(parked.result.observation, true)
  assert.match(parked.result.error, /Agent state verified \(self_evolution_transaction_busy\)/)
})

test('a conversation ChatGPT cannot load returns the attempt as a free wait', async () => {
  const unavailable = Object.assign(new Error('ChatGPT could not load this conversation'), { conversationUnavailable: true, delayMs: 120_000 })
  const result = await drive({ start: { ...REQUEST, conversation_url: 'https://chatgpt.com/c/task' }, ensureError: unavailable })
  assert.equal(result.result.status, 'waiting')
  assert.equal(result.result.observation, true)
  assert.equal(result.result.delayMs, 120_000)
})

test('the driver has no transport of its own', async () => {
  const source = await readFile(new URL('./chat-agent-orchestrator-execution.mjs', import.meta.url), 'utf8')
  for (const copied of ['fill(', 'paste(', 'expectedDownloads', 'chatGPTDeliveryContinuationPrompt', 'worker-bundle', 'new WebContentsView', 'new BrowserWindow', 'createChatGPTView']) {
    assert.equal(source.includes(copied), false, `driver still carries ${copied}`)
  }
})

test('a backend that cannot answer worker-start returns the attempt as a free wait', async () => {
  const storeDown = await drive({ startResponse: () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'orchestrator store unavailable: column "id" does not exist' } }) }) })
  assert.equal(storeDown.result.status, 'waiting')
  assert.equal(storeDown.result.observation, true)
  assert.match(storeDown.result.error, /HTTP 503: orchestrator store unavailable/)
  assert.equal(storeDown.actions.length, 0)
  const unreachable = await drive({ startResponse: () => { throw new TypeError('fetch failed') } })
  assert.equal(unreachable.result.observation, true)
  assert.match(unreachable.result.error, /backend unreachable \(fetch failed\)/)
  // A refusal about the task itself is still a charged failure.
  await assert.rejects(drive({ startResponse: () => ({ ok: false, status: 409, json: async () => ({ error: { message: 'orchestrator task does not belong to this project' } }) }) }), /HTTP 409/)
})
