import { describe, expect, it } from 'vitest'
import { addChatAttachments, pastedTextChatFile, uniquifyPastedChatFiles } from './chatAttachments'

describe('chat attachments', () => {
  it('gives generic clipboard screenshots unique names so several can coexist', () => {
    const first = new File(['one'], 'image.png', { type: 'image/png', lastModified: 1 })
    const second = new File(['two'], 'image.png', { type: 'image/png', lastModified: 1 })
    const renamed = uniquifyPastedChatFiles([], [first, second])
    expect(renamed.map((file) => file.name)).toEqual(['Prompt 01 · Clipboard 01.png', 'Prompt 01 · Clipboard 02.png'])
    expect(addChatAttachments([], renamed).files).toHaveLength(2)
  })

  it('does not impose fixed file-size or attachment-count caps in the renderer', () => {
    const many = Array.from({ length: 24 }, (_, index) => new File([new Uint8Array(32)], `file-${index}.bin`, { lastModified: index + 1 }))
    const result = addChatAttachments([], many)
    expect(result.error).toBeUndefined()
    expect(result.files).toHaveLength(24)
  })

  it('avoids names already present in the composer', () => {
    const current = [new File(['old'], 'Prompt 03 · Clipboard 01.png', { type: 'image/png' })]
    const pasted = uniquifyPastedChatFiles(current, [new File(['new'], 'image.png', { type: 'image/png' })], 3)
    expect(pasted[0].name).toBe('Prompt 03 · Clipboard 02.png')
  })

  it('names large pasted text by prompt and keeps repeated pastes distinct', () => {
    const first = pastedTextChatFile([], 'alpha', 4)
    const second = pastedTextChatFile([first], 'beta', 4)
    expect(first.name).toBe('Prompt 04 · Pasted Text 01.txt')
    expect(second.name).toBe('Prompt 04 · Pasted Text 02.txt')
  })
})
