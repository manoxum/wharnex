import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTAttachmentTools } from './attachments.mjs'

test('attachment tools keep configured limits and reject duplicate portable names', async () => {
  const tools = createChatGPTAttachmentTools({
    backendURL: 'http://127.0.0.1:8888',
    userDataPath: () => '/tmp/wharnex-test-profile',
    nativeImage: {}, getFileIcon: async () => undefined,
    fetchImpl: async () => Response.json({ attachment_count_limit: 2, request_bundle_total_bytes: 2_000_000, request_bundle_part_bytes: 1_000_000, request_bundle_part_limit: 3 }),
  })
  const limits = await tools.fetchChatTransportLimits()
  assert.deepEqual(limits, { attachmentCountLimit: 2, totalBytes: 2_000_000, partBytes: 1_048_576, partLimit: 3 })
  const attachment = { name: 'A.txt', mime: 'text/plain', contentBase64: Buffer.from('hi').toString('base64') }
  assert.equal(tools.decodeChatAttachmentSet([attachment], limits).total, 2)
  assert.throws(() => tools.decodeChatAttachmentSet([attachment, { ...attachment, name: 'a.txt' }], limits), /Duplicate attachment filename/)
  assert.throws(() => tools.decodeChatAttachmentSet([attachment, attachment, attachment], limits), /At most 2/)
  assert.equal(tools.chatAttachmentRoot(), '/tmp/wharnex-test-profile/chat-attachments-v1')
})
