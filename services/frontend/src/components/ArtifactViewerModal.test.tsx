import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactPresentationItem } from '../types'
import { ArtifactViewerModal } from './ArtifactViewerModal'

vi.mock('../lib/api', () => ({ api: {
  artifactEntryURL: (_sessionId: string, _bundleId: string, path: string, download = false) => `/artifact/entry?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
} }))

afterEach(cleanup)

describe('ArtifactViewerModal', () => {
  const items: ArtifactPresentationItem[] = [
    { path: 'artifacts/a.png', label: 'Imagem A', size: 120, content_type: 'image/png', kind: 'image' },
    { path: 'artifacts/b.png', label: 'Imagem B', size: 140, content_type: 'image/png', kind: 'image' },
  ]

  it('navigates with keyboard and exposes non-destructive image controls', () => {
    const close = vi.fn()
    render(<ArtifactViewerModal sessionId="ses_1" bundleId="bundle_1" items={items} initialIndex={0} onClose={close}/>)
    expect(screen.getByText('Imagem A')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('Imagem B')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '+ Zoom' }))
    fireEvent.click(screen.getByRole('button', { name: '↻' }))
    const image = screen.getByRole('img')
    expect(image.getAttribute('style')).toContain('scale(1.25)')
    expect(image.getAttribute('style')).toContain('rotate(90deg)')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
  })
})
