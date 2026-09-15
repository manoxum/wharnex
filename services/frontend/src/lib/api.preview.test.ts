import { describe, expect, it } from 'vitest'
import type { ComposerBundlePreviewInput } from './api'

describe('ComposerBundlePreviewInput', () => {
  it('keeps MIME optional for attachments and generated artifacts', () => {
    const input: ComposerBundlePreviewInput = {
      message: 'preview the next bundle',
      planningMode: 'direct',
      attachments: [{ name: 'notes.txt', contentBase64: 'bm90ZXM=' }],
      artifacts: [{ name: 'context.md', contentBase64: 'Y29udGV4dA==' }],
      projectFiles: ['README.md'],
    }

    expect(input.attachments[0]?.mime).toBeUndefined()
    expect(input.artifacts[0]?.mime).toBeUndefined()
  })
})
