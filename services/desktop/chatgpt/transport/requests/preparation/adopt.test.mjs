import test from 'node:test'
import assert from 'node:assert/strict'
import { adoptSubmittedPrompt } from './adopt.mjs'

function fixture(submitted) {
  const events = []
  const expectedChatGPTBundles = new Map()
  const context = {
    executeChatGPTDOMScript: async (_key, _entry, _stage, filename) => {
      events.push(['evidence', filename]); return { submitted }
    },
    chatGPTSubmittedRequestEvidenceScript: (filename) => filename,
    armExpectedChatGPTBundle: () => { events.push('arm'); expectedChatGPTBundles.set('chat', { requestId: 'req' }) },
    disarmExpectedChatGPTBundle: () => { events.push('disarm'); expectedChatGPTBundles.delete('chat') },
    enqueueChatAgentFollowups: async () => { events.push('await'); return { task_id: 'task' } },
    persistWorkspaceChatRemoteBestEffort: async () => events.push('remote'),
    expectedChatGPTBundles,
  }
  const request = { key: 'chat', target: { entry: {}, conversationUrl: 'https://chatgpt.com/c/owned' }, requestId: 'req',
    workspaceChatId: 'chat', sessionId: 'session', expectedFilename: 'response.zip', input: { archiveName: 'input.zip', uploadPaths: ['input.zip'] } }
  return { context, request, events }
}

test('an already submitted ZIP adopts response observation without another upload or submit', async () => {
  const { context, request, events } = fixture(true)
  const result = await adoptSubmittedPrompt(context, request)
  assert.equal(result.adopted, true)
  assert.deepEqual(events, [['evidence', 'input.zip'], 'arm', 'await', 'remote'])
  assert.equal(context.expectedChatGPTBundles.get('chat').rehydrating, true)
})

test('upload or task history without exact user-turn evidence never arms supervision', async () => {
  const { context, request, events } = fixture(false)
  assert.equal(await adoptSubmittedPrompt(context, request), undefined)
  assert.deepEqual(events, [['evidence', 'input.zip']])
})

test('multipart adoption requires evidence for every input part', async () => {
  const { context, request, events } = fixture(true)
  request.input.parts = [{ name: 'one.zip' }, { name: 'two.zip' }]
  context.executeChatGPTDOMScript = async (_key, _entry, _stage, name) => {
    events.push(name); return { submitted: name === 'one.zip' }
  }
  assert.equal(await adoptSubmittedPrompt(context, request), undefined)
  assert.deepEqual(events, ['one.zip', 'two.zip'])
})

test('adoption rolls back observation when durable scheduling fails', async () => {
  const { context, request, events } = fixture(true)
  context.enqueueChatAgentFollowups = async () => { throw new Error('queue unavailable') }
  await assert.rejects(adoptSubmittedPrompt(context, request), /queue unavailable/)
  assert.equal(context.expectedChatGPTBundles.size, 0)
  assert.deepEqual(events, [['evidence', 'input.zip'], 'arm', 'disarm'])
})

test('an empty part inventory cannot prove that an input was submitted', async () => {
  const { context, request, events } = fixture(true)
  request.input.parts = []
  assert.equal(await adoptSubmittedPrompt(context, request), undefined)
  assert.deepEqual(events, [])
})
