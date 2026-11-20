import { supportingOverlayWidth } from './panelAllocation'
import { describe, expect, it } from 'vitest'
import { allocateSupportingPanels, primaryWorkspaceReserve } from './panelAllocation'
import { panelPriority, rememberPanelPriority } from './panelPriority'

describe('primary workspace allocation', () => {
  it('keeps distinct preferred sizes when there is room', () => {
    expect(allocateSupportingPanels(1600, 100, { tool: 'project', preferred: 300 }, { tool: 'docker', preferred: 600 }))
      .toEqual({ left: 300, right: 600, rightOverlay: false })
  })
  it('borrows only the available slack while keeping the main workspace readable', () => {
    const left = { tool: 'project' as const, preferred: 400 }, right = { tool: 'docker' as const, preferred: 600 }
    const result = allocateSupportingPanels(1280, 100, left, right)
    expect(result.left + result.right).toBeLessThanOrEqual(1280 - 100 - primaryWorkspaceReserve(1280) + 1)
    expect(result.left).toBeGreaterThanOrEqual(200)
    expect(result.right).toBeGreaterThanOrEqual(320)
    expect(result.right).toBeGreaterThan(result.left)
    expect(left.preferred).toBe(400)
    expect(right.preferred).toBe(600)
  })
  it('overlays the right tool when readable tool minima would consume the primary workspace', () => {
    const result = allocateSupportingPanels(1100, 100, { tool: 'docker', preferred: 480 }, { tool: 'database', preferred: 600 })
    expect(result.rightOverlay).toBe(true)
    expect(1100 - 100 - result.left).toBeGreaterThanOrEqual(primaryWorkspaceReserve(1100))
    expect(result.right).toBe(600)
  })
  it('limits navigation independently from technical tools and restores preferences on a wider viewport', () => {
    expect(allocateSupportingPanels(1920, 100, { tool: 'project', preferred: 700 }).left).toBe(420)
    const narrow = allocateSupportingPanels(800, 100, { tool: 'git', preferred: 500 })
    expect(narrow.left).toBe(340)
    expect(allocateSupportingPanels(1600, 100, { tool: 'git', preferred: 500 }).left).toBe(500)
  })
  it('honours an explicit resize while the opposite tool yields space above its minimum', () => {
    const result = allocateSupportingPanels(1600, 104, { tool: 'docker', preferred: 444 }, { tool: 'database', preferred: 600 }, 'left')
    expect(result).toEqual({ left: 444, right: 492, rightOverlay: false })
    const right = allocateSupportingPanels(1600, 104, { tool: 'docker', preferred: 480 }, { tool: 'database', preferred: 524 }, 'right')
    expect(right).toEqual({ left: 412, right: 524, rightOverlay: false })
  })
  it('restores explicit resizing priority per project without leaking the previous project state', () => {
    const row = document.createElement('div')
    rememberPanelPriority(row, '/priority-first', 'left')
    rememberPanelPriority(row, '/priority-second', 'right')
    expect(panelPriority(row, '/priority-first')).toBe('left')
    expect(panelPriority(row, '/priority-second')).toBe('right')
    expect(panelPriority(document.createElement('div'), '/priority-first')).toBe('left')
    expect(panelPriority(row, '/priority-new')).toBeUndefined()
    localStorage.removeItem('wharnex.workbench.panel-priority.v1:/priority-first')
    localStorage.removeItem('wharnex.workbench.panel-priority.v1:/priority-second')
  })
})

it('keeps overlays between the two 48px rails even in narrow windows', () => {
  expect(supportingOverlayWidth(600, 700, 'docker')).toBe(504)
  expect(supportingOverlayWidth(1200, 900, 'docker')).toBe(720)
  expect(supportingOverlayWidth(80, 700, 'project')).toBe(0)
})
