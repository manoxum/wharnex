import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContentSkeleton, EditorSurfaceSkeleton, PanelSkeleton, SkeletonBlock, SkeletonLine, WorkspaceSkeleton } from './Skeleton'

describe('Skeleton placeholders', () => {
  it('renders a panel skeleton with an accessible busy label', () => {
    const { container } = render(<PanelSkeleton/>)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.querySelectorAll('.skeleton-line').length).toBeGreaterThan(0)
  })

  it('renders content and editor skeletons with accessible busy labels', () => {
    const content = render(<ContentSkeleton label="A carregar ficheiros" rows={3}/>)
    expect(content.container.querySelector('[aria-label="A carregar ficheiros"]')).toBeTruthy()
    expect(content.container.querySelectorAll('.async-content-skeleton-row')).toHaveLength(3)
    const editor = render(<EditorSurfaceSkeleton/>)
    expect(editor.container.querySelector('[aria-label="A carregar editor"]')).toBeTruthy()
  })

  it('renders a workspace skeleton previewing rail, chat and inspector regions', () => {
    const { container } = render(<WorkspaceSkeleton/>)
    expect(container.querySelector('.workspace-skeleton-rail')).toBeTruthy()
    expect(container.querySelector('.workspace-skeleton-chat')).toBeTruthy()
    expect(container.querySelector('.workspace-skeleton-inspector')).toBeTruthy()
  })

  it('renders individual line and block primitives at the requested size', () => {
    const line = render(<SkeletonLine width="42%"/>)
    expect(line.container.querySelector('.skeleton-line')?.getAttribute('style')).toContain('width: 42%')
    const block = render(<SkeletonBlock width={80} height={40}/>)
    const blockStyle = block.container.querySelector('.skeleton-block')?.getAttribute('style')
    expect(blockStyle).toContain('width: 80px')
    expect(blockStyle).toContain('height: 40px')
  })
})
