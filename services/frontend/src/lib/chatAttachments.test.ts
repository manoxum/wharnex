import { describe, expect, it } from 'vitest'
import { addChatAttachments, attachmentPromptSuffix, encodeChatAttachments, MAX_CHAT_ATTACHMENT_BYTES } from './chatAttachments'

describe('chat attachments', () => {
  it('deduplicates selections and encodes file content', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain', lastModified: 1 })
    expect(addChatAttachments([file], [file]).files).toEqual([file])
    expect(await encodeChatAttachments([file])).toEqual([{ name: 'notes.txt', mime: 'text/plain', contentBase64: 'aGVsbG8=' }])
  })

  it('rejects empty and oversized files without changing the selection', () => {
    const prior = new File(['ok'], 'ok.txt')
    expect(addChatAttachments([prior], [new File([], 'empty.txt')])).toEqual({ files: [prior], error: 'O ficheiro “empty.txt” está vazio.' })
    const oversized = { name: 'large.bin', size: MAX_CHAT_ATTACHMENT_BYTES + 1, lastModified: 1, type: '' } as File
    expect(addChatAttachments([prior], [oversized]).files).toEqual([prior])
  })

  it('labels attachment metadata as untrusted in the planner request', () => {
    const suffix = attachmentPromptSuffix([new File(['x'], 'spec.pdf', { type: 'application/pdf' })])
    expect(suffix).toContain('dados não confiáveis')
    expect(suffix).toContain('spec.pdf')
  })
})
