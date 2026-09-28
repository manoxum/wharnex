import test from 'node:test'
import assert from 'node:assert/strict'
import { executeOrchestratorExecution } from './chat-agent-orchestrator-execution.mjs'

test('Orchestrator Worker submits one request ZIP and delivers the exact response ZIP', async () => {
  const previousFetch = globalThis.fetch
  const calls = []
  const expectedFilename = 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip'
  const request = {
    task: { status: 'DOING' }, run: { id: 'run-1' }, agent_session_id: 'ses-agent',
    request_id: 'req_20260927T170000_0123456789abcdef', prompt: 'Backend-authored prompt',
    expected_filename: expectedFilename, chat_id: 'otk-abc', reasoning_effort: 'standard', agent_state: 'awaiting_plan',
  }
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) })
    return { ok: true, json: async () => String(url).endsWith('/worker-start') ? request : { task: { status: 'REVIEW' } } }
  }
  const entry = { view: { webContents: { getURL: () => 'https://chatgpt.com/' } } }
  const expectedDownloads = new Map()
  const actions = []
  const runtime = {
    baseURL: 'http://127.0.0.1:6969', homeURL: 'https://chatgpt.com/', expectedDownloads,
    pace: async () => actions.push('pace'), rateLimitDelay: () => 0,
    conversationURL: (value) => value || '', sameConversation: () => false,
    targetComposer: async () => ({ entry, wc: entry.view.webContents, conversationUrl: '' }),
    normalizeEffort: (value) => value,
    buildRequest: async () => ({ uploadPaths: ['/tmp/request.zip'], bytes: 123, archiveName: 'request.zip', bootstrap: 'Use request.zip', cleanup: async () => actions.push('cleanup') }),
    fill: async () => true, paste: async () => actions.push('paste'),
    wait: async () => undefined, settleDelay: () => 0, assistantCount: async () => 0,
    submit: async () => actions.push('submit'),
    waitConversation: async () => 'https://chatgpt.com/c/owned',
    checkpoint: async (_id, _owner, value) => actions.push(['checkpoint', value]),
    health: async () => ({ required: false }), noteRateLimit: () => false,
    humanActionMessage: () => '', completion: async () => ({ complete: true }),
    expectedDownloadScript: (name) => name,
    postBundle: async (baseURL, path, body) => {
      calls.push({ url: new URL(path, baseURL).href, body })
      return { task: { status: 'REVIEW' } }
    },
    executeDOM: async (_key, _entry, _stage, script) => {
      assert.equal(script, expectedFilename)
      expectedDownloads.get(expectedFilename).resolve(Buffer.from('response ZIP'))
      return 'exact'
    },
  }
  try {
    const task = { task_id: 'cat_0123456789abcdef0123', chat_id: 'otk_abc', session_id: 'ses-owner' }
    const payload = { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc' }
    const result = await executeOrchestratorExecution(task, entry, 'otk_abc', payload, 'worker-1', runtime)
    assert.equal(result.status, 'done')
    assert.equal(calls.length, 2)
    assert.match(calls[0].url, /worker-start$/)
    assert.match(calls[1].url, /worker-bundle$/)
    assert.equal(calls[1].body.filename, expectedFilename)
    assert.equal(Buffer.from(calls[1].body.content_base64, 'base64').toString(), 'response ZIP')
    assert.deepEqual(actions.filter((item) => item === 'paste' || item === 'submit'), ['paste', 'submit'])
    assert.equal(expectedDownloads.size, 0)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('schema rejection asks for a corrected ZIP in the same conversation', async () => {
  const previousFetch = globalThis.fetch
  const filename = 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip'
  const request = { task: { status: 'DOING' }, agent_session_id: 'ses-agent',
    request_id: 'req_20260927T170000_0123456789abcdef', expected_filename: filename,
    prompt: 'Original task', chat_id: 'otk-abc', reasoning_effort: 'instant' }
  globalThis.fetch = async () => ({ ok: true, json: async () => request })
  const entry = { view: { webContents: { getURL: () => 'https://chatgpt.com/c/owned' } } }
  const expectedDownloads = new Map()
  const submitted = []
  const filled = []
  const checkpoints = []
  let bundles = 0
  const runtime = {
    baseURL: 'http://127.0.0.1:6969', homeURL: 'https://chatgpt.com/', expectedDownloads,
    pace: async () => {}, rateLimitDelay: () => 0,
    conversationURL: (value) => value || '', sameConversation: () => true,
    targetComposer: async () => ({ entry, wc: entry.view.webContents, conversationUrl: 'https://chatgpt.com/c/owned' }),
    normalizeEffort: (value) => value,
    buildRequest: async () => ({ uploadPaths: [], bytes: 0, bootstrap: 'Original bundle', cleanup: async () => {} }),
    fill: async (_key, _entry, value) => { filled.push(value); return true },
    paste: async () => {}, wait: async () => {}, settleDelay: () => 0,
    assistantCount: async () => submitted.length,
    submit: async () => submitted.push('https://chatgpt.com/c/owned'),
    waitConversation: async () => 'https://chatgpt.com/c/owned',
    checkpoint: async (_id, _owner, value) => checkpoints.push(value),
    health: async () => ({ required: false }), noteRateLimit: () => false,
    completion: async () => ({ thinking: true }), humanActionMessage: () => '',
    expectedDownloadScript: (name) => name,
    executeDOM: async () => expectedDownloads.get(filename).resolve(Buffer.from(`bundle-${bundles}`)),
    postBundle: async () => {
      bundles += 1
      if (bundles === 1) throw new Error('orchestrator Worker worker-bundle HTTP 409: decode plan.json: json: unknown field "rationale"')
      return { task: { status: 'REVIEW' } }
    },
  }
  try {
    const task = { task_id: 'cat_0123456789abcdef0123', chat_id: 'otk_abc', session_id: 'ses-owner' }
    const payload = { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc' }
    const result = await executeOrchestratorExecution(task, entry, 'otk_abc', payload, 'worker-1', runtime)
    assert.equal(result.status, 'done')
    assert.equal(bundles, 2)
    assert.equal(submitted.length, 2)
    assert.ok(filled.at(-1).includes('"rationale"'))
    assert.equal(checkpoints[1].bundle_repair_count, 1)
    assert.equal(checkpoints[1].assistant_baseline, 1)
    assert.equal(expectedDownloads.size, 0)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('a fresh request paces only when its composer must navigate', async () => {
  const previousFetch = globalThis.fetch
  const expectedFilename = 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip'
  const request = {
    task: { status: 'DOING' }, run: { id: 'run-1' }, agent_session_id: 'ses-agent',
    request_id: 'req_20260927T170000_0123456789abcdef', prompt: 'Backend-authored prompt',
    expected_filename: expectedFilename, chat_id: 'otk-abc', reasoning_effort: 'high', agent_state: 'awaiting_plan',
  }
  globalThis.fetch = async (url) => ({ ok: true, json: async () => String(url).endsWith('/worker-start') ? request : { task: { status: 'REVIEW' } } })
  const run = async (needsNavigation) => {
    const entry = { view: { webContents: { getURL: () => 'https://chatgpt.com/' } } }
    const expectedDownloads = new Map()
    const actions = []
    const runtime = {
      baseURL: 'http://127.0.0.1:6969', homeURL: 'https://chatgpt.com/', expectedDownloads,
      pace: async () => actions.push('pace'), rateLimitDelay: () => 0, needsNavigation: () => needsNavigation,
      phase: (value) => actions.push(`phase:${value}`),
      conversationURL: (value) => value || '', sameConversation: () => false,
      targetComposer: async () => ({ entry, wc: entry.view.webContents, conversationUrl: '' }),
      normalizeEffort: (value) => value,
      buildRequest: async () => ({ uploadPaths: ['/tmp/request.zip'], bytes: 1, archiveName: 'request.zip', bootstrap: 'Use request.zip', cleanup: async () => undefined }),
      fill: async () => true, paste: async () => actions.push('paste'),
      wait: async () => undefined, settleDelay: () => 0, assistantCount: async () => 0,
      submit: async () => actions.push('submit'), waitConversation: async () => 'https://chatgpt.com/c/owned',
      checkpoint: async () => undefined, health: async () => ({ required: false }), noteRateLimit: () => false,
      humanActionMessage: () => '', completion: async () => ({ complete: true }), expectedDownloadScript: (name) => name,
      postBundle: async () => ({ task: { status: 'REVIEW' } }),
      executeDOM: async () => { expectedDownloads.get(expectedFilename).resolve(Buffer.from('zip')); return 'exact' },
    }
    const task = { task_id: 'cat_0123456789abcdef0123', chat_id: 'otk_abc', session_id: 'ses-owner' }
    const result = await executeOrchestratorExecution(task, entry, 'otk_abc', { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc' }, 'worker-1', runtime)
    assert.equal(result.status, 'done')
    return actions
  }
  try {
    const inPlace = await run(false)
    assert.equal(inPlace.filter((item) => item === 'pace').length, 0)
    assert.ok(inPlace.includes('phase:validating'))
    const navigating = await run(true)
    assert.deepEqual(navigating.slice(0, 2), ['pace', 'paste'])
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('an attempt whose task left execution settles instead of returning to the queue', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ task: { status: 'REVIEW' }, agent_state: 'settled' }) })
  try {
    const entry = { view: { webContents: { getURL: () => 'https://chatgpt.com/' } } }
    const task = { task_id: 'cat_0123456789abcdef0123', chat_id: 'otk_abc', session_id: 'ses-owner' }
    const result = await executeOrchestratorExecution(task, entry, 'otk_abc', { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc' }, 'worker-1', { baseURL: 'http://127.0.0.1:6969' })
    assert.deepEqual(result, { status: 'done' })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('an Agent continuation after an accepted bundle does not spend a Worker attempt', async () => {
  const previousFetch = globalThis.fetch
  const expectedFilename = 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip'
  const request = {
    task: { status: 'DOING' }, run: { id: 'run-1' }, agent_session_id: 'ses-agent',
    request_id: 'req_20260927T170000_0123456789abcdef', prompt: 'Backend-authored prompt',
    expected_filename: expectedFilename, chat_id: 'otk-abc', reasoning_effort: 'high', agent_state: 'awaiting_plan',
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => request })
  try {
    const entry = { view: { webContents: { getURL: () => 'https://chatgpt.com/' } } }
    const expectedDownloads = new Map()
    const runtime = {
      baseURL: 'http://127.0.0.1:6969', homeURL: 'https://chatgpt.com/', expectedDownloads,
      pace: async () => undefined, rateLimitDelay: () => 0, needsNavigation: () => false,
      conversationURL: (value) => value || '', sameConversation: () => false,
      targetComposer: async () => ({ entry, wc: entry.view.webContents, conversationUrl: '' }),
      normalizeEffort: (value) => value,
      buildRequest: async () => ({ uploadPaths: ['/tmp/request.zip'], bytes: 1, archiveName: 'request.zip', bootstrap: 'Use request.zip', cleanup: async () => undefined }),
      fill: async () => true, paste: async () => undefined,
      wait: async () => undefined, settleDelay: () => 0, assistantCount: async () => 0,
      submit: async () => undefined, waitConversation: async () => 'https://chatgpt.com/c/owned',
      checkpoint: async () => undefined, health: async () => ({ required: false }), noteRateLimit: () => false,
      humanActionMessage: () => '', completion: async () => ({ complete: true }), expectedDownloadScript: (name) => name,
      // The Agent took the bundle and is still DOING: its next round is ready.
      postBundle: async () => ({ task: { status: 'DOING' } }),
      executeDOM: async () => { expectedDownloads.get(expectedFilename).resolve(Buffer.from('zip')); return 'exact' },
    }
    const task = { task_id: 'cat_0123456789abcdef0123', chat_id: 'otk_abc', session_id: 'ses-owner' }
    const result = await executeOrchestratorExecution(task, entry, 'otk_abc', { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc' }, 'worker-1', runtime)
    assert.equal(result.status, 'waiting')
    assert.equal(result.observation, true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('a conversation ChatGPT cannot load returns the attempt as a free wait, not a failure', async () => {
  const previousFetch = globalThis.fetch
  const request = {
    task: { status: 'DOING' }, run: { id: 'run-1' }, agent_session_id: 'ses-agent',
    request_id: 'req_20260927T170000_0123456789abcdef', prompt: 'Backend-authored prompt',
    expected_filename: 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip', chat_id: 'otk-abc', reasoning_effort: 'high', agent_state: 'awaiting_plan',
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => request })
  try {
    const entry = { view: { webContents: { getURL: () => 'https://chatgpt.com/' } } }
    const unavailable = Object.assign(new Error('ChatGPT could not load this conversation'), { conversationUnavailable: true, delayMs: 120_000 })
    const runtime = {
      baseURL: 'http://127.0.0.1:6969', homeURL: 'https://chatgpt.com/', expectedDownloads: new Map(),
      conversationURL: (value) => value || '', sameConversation: () => false,
      loadURL: async () => undefined, waitSurfaceReady: async () => { throw unavailable },
    }
    const task = { task_id: 'cat_0123456789abcdef0123', chat_id: 'otk_abc', session_id: 'ses-owner' }
    const payload = { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc', active_request_id: request.request_id, expected_filename: request.expected_filename, conversation_url: 'https://chatgpt.com/c/owned' }
    const result = await executeOrchestratorExecution(task, entry, 'otk_abc', payload, 'worker-1', runtime)
    assert.deepEqual(result, { status: 'waiting', delayMs: 120_000, observation: true, error: 'ChatGPT could not load this conversation' })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('a request that never delivers gets bounded delivery continuations before attention, like agentic mode', async () => {
  const previousFetch = globalThis.fetch
  const expectedFilename = 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip'
  const request = {
    task: { status: 'DOING' }, run: { id: 'run-1' }, agent_session_id: 'ses-agent',
    request_id: 'req_20260927T170000_0123456789abcdef', prompt: 'Backend-authored prompt',
    expected_filename: expectedFilename, chat_id: 'otk-abc', reasoning_effort: 'high', agent_state: 'awaiting_plan',
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => request })
  try {
    let clock = 0
    const fills = []
    const checkpoints = []
    const entry = { view: { webContents: { getURL: () => 'https://chatgpt.com/c/owned' } } }
    const runtime = {
      baseURL: 'http://127.0.0.1:6969', homeURL: 'https://chatgpt.com/', expectedDownloads: new Map(),
      now: () => clock, wait: async (ms) => { clock += ms },
      pace: async () => undefined, rateLimitDelay: () => 0,
      conversationURL: (value) => value || '', sameConversation: () => true,
      loadURL: async () => undefined, waitSurfaceReady: async () => undefined,
      assistantCount: async () => 3, fill: async (_key, _entry, text) => { fills.push(text); return true },
      submit: async () => undefined, checkpoint: async (_id, _owner, value) => checkpoints.push(value),
      health: async () => ({ required: false }), noteRateLimit: () => false, humanActionMessage: () => '',
      completion: async () => ({ complete: true }), expectedDownloadScript: (name) => name,
      executeDOM: async () => '',
    }
    const task = { task_id: 'cat_0123456789abcdef0123', chat_id: 'otk_abc', session_id: 'ses-owner' }
    const payload = { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc', active_request_id: request.request_id, expected_filename: expectedFilename, conversation_url: 'https://chatgpt.com/c/owned' }
    const result = await executeOrchestratorExecution(task, entry, 'otk_abc', payload, 'worker-1', runtime)
    assert.deepEqual(fills, ['keep continue', 'keep continue'])
    assert.deepEqual(checkpoints.map((value) => value.delivery_continuation_count), [1, 2])
    assert.equal(result.status, 'attention')
  } finally {
    globalThis.fetch = previousFetch
  }
})

function evidenceRuntime({ accepted, evidence, actions, payloadURL = '' }) {
  const expectedFilename = 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip'
  const entry = { view: { webContents: { getURL: () => payloadURL || 'https://chatgpt.com/' } } }
  const expectedDownloads = new Map()
  let evidenceCalls = 0
  const runtime = {
    baseURL: 'http://127.0.0.1:6969', homeURL: 'https://chatgpt.com/', expectedDownloads,
    pace: async () => undefined, rateLimitDelay: () => 0, needsNavigation: () => false,
    conversationURL: (value) => value || '', sameConversation: () => true,
    loadURL: async () => undefined, waitSurfaceReady: async () => undefined,
    targetComposer: async () => ({ entry, wc: entry.view.webContents, conversationUrl: '' }),
    normalizeEffort: (value) => value,
    buildRequest: async () => ({ uploadPaths: ['/tmp/request.zip'], bytes: 1, archiveName: 'request.zip', bootstrap: 'Use request.zip', cleanup: async () => undefined }),
    fill: async () => true, paste: async () => actions.push('paste'),
    wait: async () => undefined, settleDelay: () => 0, assistantCount: async () => 0,
    submit: async () => { actions.push('submit'); return { accepted } },
    submittedEvidence: async () => { evidenceCalls += 1; return { submitted: evidence(evidenceCalls) } },
    waitConversation: async () => 'https://chatgpt.com/c/owned',
    checkpoint: async () => actions.push('checkpoint'), health: async () => ({ required: false }), noteRateLimit: () => false,
    humanActionMessage: () => '', completion: async () => ({ complete: true }), expectedDownloadScript: (name) => name,
    postBundle: async () => ({ task: { status: 'REVIEW' } }),
    executeDOM: async () => { expectedDownloads.get(expectedFilename)?.resolve(Buffer.from('zip')); return 'exact' },
  }
  return { runtime, entry, expectedFilename }
}

test('an unconfirmed submit with no request in the conversation is sent again, as agentic mode resends', async () => {
  const previousFetch = globalThis.fetch
  const request = { task: { status: 'DOING' }, run: { id: 'run-1' }, agent_session_id: 'ses-agent', request_id: 'req_20260927T170000_0123456789abcdef', prompt: 'p', expected_filename: 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip', chat_id: 'otk-abc', agent_state: 'awaiting_plan' }
  globalThis.fetch = async () => ({ ok: true, json: async () => request })
  try {
    const actions = []
    const { runtime, entry } = evidenceRuntime({ accepted: false, evidence: (call) => call > 1, actions })
    const task = { task_id: 'cat_0123456789abcdef0123', chat_id: 'otk_abc', session_id: 'ses-owner' }
    const result = await executeOrchestratorExecution(task, entry, 'otk_abc', { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc' }, 'worker-1', runtime)
    assert.equal(result.status, 'done')
    assert.deepEqual(actions.filter((item) => item === 'submit'), ['submit', 'submit'])
    // Never submitted at all: the attempt fails before any checkpoint claims a live request.
    const failed = []
    const never = evidenceRuntime({ accepted: false, evidence: () => false, actions: failed })
    await assert.rejects(executeOrchestratorExecution(task, never.entry, 'otk_abc', { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc' }, 'worker-1', never.runtime), /not submitted/)
    assert.equal(failed.includes('checkpoint'), false)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('resuming a request that is not in the conversation submits it instead of waiting for its ZIP', async () => {
  const previousFetch = globalThis.fetch
  const request = { task: { status: 'DOING' }, run: { id: 'run-1' }, agent_session_id: 'ses-agent', request_id: 'req_20260927T170000_0123456789abcdef', prompt: 'p', expected_filename: 'whx_bundle_res_otk-abc_req_20260927T170000_0123456789abcdef.zip', chat_id: 'otk-abc', agent_state: 'awaiting_plan' }
  globalThis.fetch = async () => ({ ok: true, json: async () => request })
  try {
    const actions = []
    const { runtime, entry } = evidenceRuntime({ accepted: true, evidence: () => false, actions, payloadURL: 'https://chatgpt.com/c/owned' })
    const task = { task_id: 'cat_0123456789abcdef0123', chat_id: 'otk_abc', session_id: 'ses-owner' }
    const payload = { protocol: 'harness.orchestrator-execution/v1', task_id: 'otk_abc', active_request_id: request.request_id, expected_filename: request.expected_filename, conversation_url: 'https://chatgpt.com/c/owned' }
    const result = await executeOrchestratorExecution(task, entry, 'otk_abc', payload, 'worker-1', runtime)
    assert.equal(result.status, 'done')
    assert.deepEqual(actions.slice(0, 2), ['paste', 'submit'])
  } finally {
    globalThis.fetch = previousFetch
  }
})
