import { readPromptTransportSource } from '../composition/transport/prompt-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSource = () => readPromptTransportSource()

test('retired remote input stays out of the Desktop planner transport', async () => {
  const source = await mainSource()
  const start = source.indexOf('async function preparePromptForChatGPT(')
  const end = source.indexOf('\nasync function attachContextToChatGPT', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const prepare = source.slice(start, end)

  assert.doesNotMatch(source, /from '\.\/remote-input(?:-timeout)?\.mjs'/)
  assert.doesNotMatch(source, /remoteInputPublicationSignal/)
  assert.doesNotMatch(source, /publishRemoteChatInput/)
  assert.doesNotMatch(prepare, /tunnelInstanceIds/)
  assert.match(prepare, /withRequestPreparationDeadline\(signal, \(bounded\) => materializeChatInput\(/)
  assert.match(prepare, /localChatInputBootstrap\(requestId, input\.archiveName, expectedFilename, input\.requestMetadata, input\.multipart\)/)
})
