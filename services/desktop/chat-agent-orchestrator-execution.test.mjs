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

async function drive({ start = REQUEST, supervision = { state: 'none' }, payload = PAYLOAD, adopt = false, stored = '' } = {}) {
  const previousFetch = globalThis.fetch
  const calls = []
  const actions = []
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push({ url: String(url), body })
    const response = String(url).endsWith('/worker-start') ? start : { conversation_url: stored || body.conversation_url }
    return { ok: true, json: async () => response }
  }
  const runtime = {
    baseURL: 'http://127.0.0.1:6969', homeURL: 'https://chatgpt.com/',
    pace: async () => actions.push('pace'), rateLimitDelay: () => 0,
    needsNavigation: (_entry, url) => url !== 'https://chatgpt.com/',
    conversationURL: (value) => value || '',
    checkpoint: async (_id, _owner, value) => actions.push(['checkpoint', value]),
    supervision: async () => supervision,
    adopt: async () => { actions.push('adopt'); return adopt },
    sendMainRequest: async (_key, _entry, current, url) => {
      actions.push(['send', current.request_id, url])
      return { conversationUrl: url || 'https://chatgpt.com/c/new' }
    },
  }
  try {
    const result = await executeOrchestratorExecution(TASK, entry, 'otk_abc', payload, 'worker-1', runtime)
    return { result, calls, actions }
  } finally {
    globalThis.fetch = previousFetch
  }
}

test('a pending Agent request is sent through the agentic pipeline and its conversation kept', async () => {
  const { result, calls, actions } = await drive()
  assert.equal(result.status, 'waiting')
  assert.equal(result.observation, true)
  assert.deepEqual(actions.find((item) => item[0] === 'send'), ['send', REQUEST.request_id, ''])
  assert.match(calls[1].url, /worker-conversation$/)
  assert.equal(calls[1].body.conversation_url, 'https://chatgpt.com/c/new')
  const checkpoint = actions.find((item) => item[0] === 'checkpoint')[1]
  assert.equal(checkpoint.active_request_id, REQUEST.request_id)
  assert.equal(checkpoint.conversation_url, 'https://chatgpt.com/c/new')
})

test('every round continues in the task conversation', async () => {
  const { actions } = await drive({ start: { ...REQUEST, conversation_url: 'https://chatgpt.com/c/task' } })
  assert.deepEqual(actions.find((item) => item[0] === 'send'), ['send', REQUEST.request_id, 'https://chatgpt.com/c/task'])
  // A different page needs its paced navigation before the send.
  assert.equal(actions[0], 'pace')
})

test('a request the agentic supervision owns or delivered is only observed', async () => {
  for (const state of ['active', 'delivered']) {
    const { result, actions } = await drive({ supervision: { state } })
    assert.equal(result.status, 'waiting')
    assert.equal(result.observation, true)
    assert.equal(actions.some((item) => item[0] === 'send'), false)
  }
})

test('supervision that gave up ends the run', async () => {
  const { result } = await drive({ supervision: { state: 'ended', error: 'ChatGPT did not provide the ZIP after 2 delivery continuations' } })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /delivery continuations/)
})

test('a request an earlier attempt submitted is adopted instead of sent twice', async () => {
  const payload = { ...PAYLOAD, active_request_id: REQUEST.request_id, conversation_url: 'https://chatgpt.com/c/task', assistant_baseline: 4 }
  const adopted = await drive({ payload, adopt: true })
  assert.deepEqual(adopted.actions, ['adopt'])
  assert.equal(adopted.result.observation, true)
  const missing = await drive({ payload, adopt: false })
  assert.ok(missing.actions.some((item) => item[0] === 'send'))
})

test('a settled task ends the driver and an idle Agent is observed for free', async () => {
  assert.equal((await drive({ start: { task: { status: 'REVIEW' } } })).result.status, 'done')
  const idle = await drive({ start: { ...REQUEST, request_id: '', agent_state: 'executing' } })
  assert.equal(idle.result.status, 'waiting')
  assert.equal(idle.result.observation, true)
  assert.match(idle.result.error, /Agent state executing/)
})

test('a conversation ChatGPT cannot load returns the attempt as a free wait', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => REQUEST })
  const unavailable = Object.assign(new Error('ChatGPT could not load this conversation'), { conversationUnavailable: true, delayMs: 120_000 })
  try {
    const result = await executeOrchestratorExecution(TASK, entry, 'otk_abc', PAYLOAD, 'worker-1', {
      baseURL: 'http://127.0.0.1:6969', homeURL: 'https://chatgpt.com/', supervision: async () => { throw unavailable },
    })
    assert.equal(result.status, 'waiting')
    assert.equal(result.observation, true)
    assert.equal(result.delayMs, 120_000)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('the driver has no transport of its own', async () => {
  const source = await readFile(new URL('./chat-agent-orchestrator-execution.mjs', import.meta.url), 'utf8')
  for (const copied of ['fill(', 'paste(', 'expectedDownloads', 'chatGPTDeliveryContinuationPrompt', 'worker-bundle']) {
    assert.equal(source.includes(copied), false, `driver still carries ${copied}`)
  }
})
