import { describe, expect, it } from 'vitest'
import { addChatAttachments, uniquifyPastedChatFiles } from './chatAttachments'

describe('chat attachments', () => {
  it('gives generic clipboard screenshots unique names so several can coexist', () => {
    const first = new File(['one'], 'image.png', { type: 'image/png', lastModified: 1 })
    const second = new File(['two'], 'image.png', { type: 'image/png', lastModified: 1 })
    const renamed = uniquifyPastedChatFiles([], [first, second])
    expect(renamed.map((file) => file.name)).toEqual(['clipboard-image-001.png', 'clipboard-image-002.png'])
    expect(addChatAttachments([], renamed).files).toHaveLength(2)
  })

  it('avoids names already present in the composer', () => {
    const current = [new File(['old'], 'clipboard-image-001.png', { type: 'image/png' })]
    const pasted = uniquifyPastedChatFiles(current, [new File(['new'], 'image.png', { type: 'image/png' })])
    expect(pasted[0].name).toBe('clipboard-image-002.png')
  })
})
