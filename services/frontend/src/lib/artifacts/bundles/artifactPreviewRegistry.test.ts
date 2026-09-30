import { describe, expect, it } from 'vitest'
import { artifactPreviewDefinition } from './artifactPreviewRegistry'

describe('artifactPreviewDefinition', () => {
  it('infers Draw.io files with local preview and source capabilities', () => {
    expect(artifactPreviewDefinition('artifacts/architecture.drawio')).toEqual({
      kind: 'drawio',
      capabilities: ['preview', 'raw', 'wrap', 'download'],
    })
  })

  it('accepts drawio explicitly and overrides a generic binary declaration by extension', () => {
    expect(artifactPreviewDefinition('artifact.bin', 'drawio').kind).toBe('drawio')
    expect(artifactPreviewDefinition('diagram.drawio', 'binary').kind).toBe('drawio')
    expect(artifactPreviewDefinition('diagram.drawio', 'text').kind).toBe('drawio')
  })
})
