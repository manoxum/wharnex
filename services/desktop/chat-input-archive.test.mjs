import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { chatInputArchiveFilename, localChatInputBootstrap, writeChatInputArchive } from './chat-input-archive.mjs'

function storedEntries(buffer) {
  const entries = new Map()
  let offset = 0
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8)
    const size = buffer.readUInt32LE(offset + 18)
    const nameBytes = buffer.readUInt16LE(offset + 26)
    const extraBytes = buffer.readUInt16LE(offset + 28)
    assert.equal(method, 0)
    const nameStart = offset + 30
    const dataStart = nameStart + nameBytes + extraBytes
    const name = buffer.subarray(nameStart, nameStart + nameBytes).toString('utf8')
    entries.set(name, buffer.subarray(dataStart, dataStart + size))
    offset = dataStart + size
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50)
  assert.equal(buffer.readUInt32LE(buffer.byteLength - 22), 0x06054b50)
  return entries
}

test('direct ChatGPT input is one ZIP with prompt, context, artifacts and user files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-input-'))
  try {
    const requestId = 'req_20260905T083123_example123'
    const filename = chatInputArchiveFilename(requestId)
    const target = path.join(root, filename)
    const result = await writeChatInputArchive(target, {
      requestId,
      prompt: '# Planner\n\nReturn the bundle.',
      context: { bytes: Buffer.from('UEsDBBQAAAAIAFpiJl1Dv6ajBAAAAAIAAAANAAAAbWFuaWZlc3QuanNvbquuBQBQSwMEFAAAAAgAWmImXU5FPCsVAAAAEwAAAAsAAABzcmMvQXBwLnRzeEutKMgvKlFIzs8rLlGoULBVMOQCAFBLAQIUAxQAAAAIAFpiJl1Dv6ajBAAAAAIAAAANAAAAAAAAAAAAAACAAQAAAABtYW5pZmVzdC5qc29uUEsBAhQDFAAAAAgAWmImXU5FPCsVAAAAEwAAAAsAAAAAAAAAAAAAAIABLwAAAHNyYy9BcHAudHN4UEsFBgAAAAACAAIAdAAAAG0AAAAAAA==', 'base64') },
      artifacts: [{ name: 'result.md', bytes: Buffer.from('result') }],
      attachments: [{ name: 'notes.txt', bytes: Buffer.from('notes') }],
      projectFiles: ['src/App.tsx'],
      liveTunnels: [
        { provider: 'primary', instance_id: 'tunnel-1', status: 'https://primary.example/status', manifest: 'https://primary.example/secret/manifest.json' },
        { provider: 'fallback', instance_id: 'tunnel-2', status: 'https://fallback.example/status', manifest: 'https://fallback.example/secret/manifest.json' },
      ],
    })
    const raw = await readFile(target)
    const entries = storedEntries(raw)
    assert.equal(raw.byteLength, result.bytes)
    assert.equal(result.fileCount, 7)
    assert.deepEqual([...entries.keys()], [
      'transport.json',
      'prompt/wharness-planner-prompt.md',
      'context/manifest.json',
      'context/src/App.tsx',
      'references/project-files.json',
      'artifacts/result.md',
      'attachments/notes.txt',
    ])
    const transport = JSON.parse(entries.get('transport.json').toString('utf8'))
    assert.equal(transport.protocol, 'wharness.chat-input/v1')
    assert.deepEqual(transport.live_tunnels.map((item) => item.instance_id), ['tunnel-1', 'tunnel-2'])
    assert.equal(entries.get('prompt/wharness-planner-prompt.md').toString('utf8'), '# Planner\n\nReturn the bundle.\n')
    assert.equal(entries.get('context/src/App.tsx').toString('utf8'), 'export const x = 1\n')
    assert.equal(entries.get('attachments/notes.txt').toString('utf8'), 'notes')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local bootstrap points the model at the prompt inside the single archive', () => {
  const requestId = 'req_20260905T083123_example123'
  const archive = chatInputArchiveFilename(requestId)
  const bootstrap = localChatInputBootstrap(requestId, archive, `wharness-bundle-${requestId}.zip`)
  assert.match(bootstrap, new RegExp(archive.replaceAll('.', '\\.')))
  assert.match(bootstrap, /prompt\/wharness-planner-prompt\.md/)
  assert.match(bootstrap, new RegExp(`wharness-bundle-${requestId}\\.zip`))
  assert.doesNotMatch(bootstrap, /Return the bundle|USER REQUEST|PROJECT MANIFEST/)
  assert.equal(bootstrap.split('\n').length, 2)
})

test('input archive filename rejects non-canonical request ids', () => {
  assert.throws(() => chatInputArchiveFilename('request-1'), /Invalid Wharness request id/)
})
