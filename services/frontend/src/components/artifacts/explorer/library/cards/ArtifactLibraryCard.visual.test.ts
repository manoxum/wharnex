import { describe, expect, it } from 'vitest'
import { ARTIFACT_LIBRARY_BUNDLE_CARD_CLASS, ARTIFACT_LIBRARY_CARD_CLASS, ARTIFACT_LIBRARY_FILE_CARD_CLASS, ARTIFACT_LIBRARY_GRID_CLASS, ARTIFACT_LIBRARY_PREVIEW_CLASS, ARTIFACT_LIBRARY_SELECTED_CARD_CLASS } from './libraryCardStyles'

describe('artifact library visual contract', () => {
  it('keeps cards compact, readable, responsive and accessible to reduced-motion users', () => {
    expect(ARTIFACT_LIBRARY_GRID_CLASS).toContain('minmax(min(100%,220px),1fr)')
    expect(ARTIFACT_LIBRARY_GRID_CLASS).toContain('overflow-auto')
    expect(ARTIFACT_LIBRARY_FILE_CARD_CLASS).toContain('grid-rows-[122px_auto_40px]')
    expect(ARTIFACT_LIBRARY_CARD_CLASS).toContain('motion-reduce:transition-none')
    expect(ARTIFACT_LIBRARY_BUNDLE_CARD_CLASS).toContain('aspect-[4/3]')
    expect(ARTIFACT_LIBRARY_BUNDLE_CARD_CLASS).toContain('min-h-[192px]')
    expect(ARTIFACT_LIBRARY_SELECTED_CARD_CLASS).toContain('border-whx-accent')
    expect(ARTIFACT_LIBRARY_PREVIEW_CLASS).toContain('[&_.artifact-media-preview_img]:!object-cover')
  })
})
