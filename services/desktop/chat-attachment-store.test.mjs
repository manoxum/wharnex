import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseStoredAttachmentRef, persistChatAttachmentFiles, readStoredAttachmentPreview, removeStoredChatAttachments, storedAttachmentPath } from './chat-attachment-store.mjs'

test('stored attachment refs are narrow local identifiers', () => {
  assert.deepEqual(parseStoredAttachmentRef('chat-1/message-1/0'), { cacheKey: 'chat-1', messageId: 'message-1', index: 0 })
  assert.throws(() => parseStoredAttachmentRef('../escape/message/0'))
  assert.throws(() => parseStoredAttachmentRef('chat/message/../../0'))
  assert.throws(() => parseStoredAttachmentRef('chat/message/nope'))
})

test('attachment files and previews survive later reads and can be removed per chat', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-attachments-'))
  // Every run of this suite left its store behind; the checkout-private
  // temporary root that TMPDIR points at accumulated one per run forever.
  t.after(() => rm(root, { recursive: true, force: true }))
  const stored = await persistChatAttachmentFiles(root, 'chat-1', 'message-1', [
    { name: 'screen.png', mime: 'image/png', bytes: Buffer.from('image-bytes') },
  ], async (_source, preview) => {
    await import('node:fs/promises').then(({ writeFile }) => writeFile(preview, Buffer.from('preview-bytes')))
    return 'thumbnail'
  })

  assert.equal(stored[0].storageRef, 'chat-1/message-1/0')
  assert.equal(await readFile(await storedAttachmentPath(root, stored[0].storageRef), 'utf8'), 'image-bytes')
  const preview = await readStoredAttachmentPreview(root, stored[0].storageRef)
  assert.equal(Buffer.from(preview.dataUrl.split(',')[1], 'base64').toString(), 'preview-bytes')
  await removeStoredChatAttachments(root, 'chat-1')
  await assert.rejects(() => storedAttachmentPath(root, stored[0].storageRef))
})
