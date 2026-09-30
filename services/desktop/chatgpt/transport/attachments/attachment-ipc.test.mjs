import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerChatAttachmentIPC } from './attachment-ipc.mjs'

test('attachment IPC registers only the named operations and checks the sender first', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-attachment-ipc-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const handlers = new Map()
  let trusted = false
  registerChatAttachmentIPC({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    trustedSender: () => { if (!trusted) throw new Error('untrusted sender') },
    shell: { openPath: async () => '' },
    fetchChatTransportLimits: async () => ({}),
    decodeChatAttachmentSet: () => ({ decoded: [{ name: 'note.txt', mime: 'text/plain', bytes: Buffer.from('hello') }] }),
    chatAttachmentRoot: () => dir,
    createPersistentAttachmentPreview: async () => 'none',
  })
  assert.deepEqual([...handlers.keys()], [
    'wharness:attachments:persist', 'wharness:attachments:preview',
    'wharness:attachments:read', 'wharness:attachments:open',
    'wharness:attachments:remove-chat',
  ])
  await assert.rejects(handlers.get('wharness:attachments:persist')({}, { cacheKey: 'chat123', messageId: 'message1' }), /untrusted sender/)

  trusted = true
  const saved = await handlers.get('wharness:attachments:persist')({}, { cacheKey: 'chat123', messageId: 'message1' })
  assert.equal(saved.ok, true)
  assert.equal(saved.attachments.length, 1)
  const storageRef = saved.attachments[0].storageRef
  const read = await handlers.get('wharness:attachments:read')({}, { storageRef })
  assert.equal(Buffer.from(read.contentBase64, 'base64').toString(), 'hello')
  await handlers.get('wharness:attachments:remove-chat')({}, { cacheKey: 'chat123' })
})
