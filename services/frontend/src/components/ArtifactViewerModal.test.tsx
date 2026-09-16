import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactPresentationItem } from '../types'
import { ArtifactViewerModal } from './ArtifactViewerModal'

vi.mock('../lib/api', () => ({ api: {
  artifactEntryURL: (_sessionId: string, _bundleId: string, path: string, download = false) => `/artifact/entry?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
  artifactURL: (_sessionId: string, artifactId: string, preview = false) => `/artifact/${artifactId}${preview ? '?preview=1' : ''}`,
} }))

afterEach(cleanup)

describe('ArtifactViewerModal', () => {
  const items: ArtifactPresentationItem[] = [
    { path: 'artifacts/a.png', label: 'Imagem A', size: 120, content_type: 'image/png', kind: 'image' },
    { path: 'artifacts/b.png', label: 'Imagem B', size: 140, content_type: 'image/png', kind: 'image' },
  ]

  it('keeps direct artifact downloads on the raw endpoint while preview stays inline', () => {
    render(<ArtifactViewerModal sessionId="ses_1" artifactId="artifact_direct" items={[{ path: 'report.pdf', size: 512, content_type: 'application/pdf', kind: 'pdf' }]} initialIndex={0} onClose={vi.fn()}/>)
    expect(screen.getByTitle('Descarregar report.pdf').getAttribute('href')).toBe('/artifact/artifact_direct')
    expect(screen.getByTitle('Pré-visualização de report.pdf').getAttribute('src')).toBe('/artifact/artifact_direct?preview=1')
  })
  it('navigates with keyboard and exposes non-destructive image controls', () => {
    const close = vi.fn()
    render(<ArtifactViewerModal sessionId="ses_1" bundleId="bundle_1" items={items} initialIndex={0} onClose={close}/>)
    expect(screen.getByText('Imagem A')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('Imagem B')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '+ Zoom' }))
    expect(screen.getByLabelText('Zoom atual').textContent).toBe('125%')
    fireEvent.click(screen.getByRole('button', { name: '↻' }))
    const image = screen.getByRole('img')
    expect(image.getAttribute('style')).toContain('scale(1.25)')
    expect(image.getAttribute('style')).toContain('rotate(90deg)')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('does not use arrow-key navigation while an adjustment control is active', () => {
    render(<ArtifactViewerModal sessionId="ses_1" bundleId="bundle_1" items={items} initialIndex={0} onClose={vi.fn()}/>)
    const brightness = screen.getByRole('slider', { name: 'Brilho' })
    brightness.focus()
    fireEvent.keyDown(brightness, { key: 'ArrowRight' })
    expect(screen.getByText('Imagem A')).toBeTruthy()
  })

})
