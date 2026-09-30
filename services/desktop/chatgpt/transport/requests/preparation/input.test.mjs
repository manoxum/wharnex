import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatInputPreparation } from './input.mjs'

function fixture({ composerFilled = true } = {}) {
  const events = []
  const saved = []
  const transport = {
    archivePath: '/tmp/input/archive.zip', archiveName: 'archive.zip',
    uploadPaths: ['/tmp/input/archive.zip'], bytes: 10, fileCount: 1,
    parts: [{ name: 'archive.zip', path: '/tmp/input/archive.zip' }],
  }
  const operations = createChatInputPreparation({
    chatAgentWorkerActivity: { set: (state) => events.push(state) },
    requestPreparationTimer: () => ({ phase: (phase) => events.push(phase) }),
    throwIfChatGPTTransportAborted: () => {},
    fetchChatTransportLimits: async () => ({ totalBytes: 100, partLimit: 2 }),
    decodeChatAttachmentSet: () => ({ decoded: [] }),
    decodeChatArtifactSet: () => ({ decoded: [] }),
    path: { join: (...parts) => parts.join('/'), dirname: () => '/tmp/input' },
    app: { getPath: () => '/tmp' },
    rm: async (path) => events.push(`rm:${path}`),
    mkdir: async () => events.push('mkdir'),
    fetchRequestKnowledge: async () => 'knowledge',
    fetchRequestGitContext: async () => 'git',
    fetchRequestContinuation: async () => [],
    fetchSelectedContextZip: async () => ({ bytes: Buffer.from('context') }),
    writeChatInputTransportArchives: async (_dir, payload) => {
      events.push('zip')
      assert.equal(payload.requestId, 'req-1')
      return transport
    },
    boundedChatInputPartBytes: () => 50,
    persistChatArtifact: async (...args) => saved.push(args),
    readFile: async () => Buffer.from('zip'),
    randomUUID: () => 'uuid',
    withRequestPreparationDeadline: async (_signal, operation) => operation(undefined),
    localChatInputBootstrap: () => 'bootstrap',
    chatGPTFillComposerScript: () => 'script',
    pasteChatGPTFile: async () => events.push('paste'),
    wait: async () => events.push('settle'),
    chatInputSettleDelay: () => 1,
  })
  const entry = { view: { webContents: { executeJavaScript: async () => composerFilled } } }
  return { operations, events, saved, entry }
}

test('protocol input persists each ZIP part before returning it to the composer', async () => {
  const { operations, saved } = fixture()
  const result = await operations.materializeProtocolChatInput('chat-1', 'session-1', 'req-1', 'prompt')
  assert.equal(result.archiveEntryCount, 1)
  assert.deepEqual(saved.map((args) => [args[2], args[3], args[4]]), [['input', 'bundle', 'archive.zip']])
})

test('composer failure deletes transient ZIPs without uploading a file', async () => {
  const { operations, events, entry } = fixture({ composerFilled: false })
  await assert.rejects(
    operations.fillBundledChatGPTComposer('chat-1', entry, 'session-1', 'req-1', 'prompt', 'response.zip'),
    /could not be populated/,
  )
  assert.ok(events.includes('rm:/tmp/input'))
  assert.ok(!events.includes('paste'))
})
