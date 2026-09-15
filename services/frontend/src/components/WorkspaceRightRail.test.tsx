import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceRightRail } from './WorkspaceRightRail'

describe('WorkspaceRightRail', () => {
  it('routes both right-side tools and renders the PostgreSQL first phase', () => {
    const onDrawer = vi.fn()
    const onError = vi.fn()
    const view = render(<WorkspaceRightRail drawer="" onDrawer={onDrawer} onError={onError}/>)

    fireEvent.click(screen.getByLabelText('Explorador de artefactos'))
    expect(onDrawer).toHaveBeenCalledWith('artifacts')
    fireEvent.click(screen.getByLabelText('Database connection'))
    expect(onDrawer).toHaveBeenCalledWith('database')

    view.rerender(<WorkspaceRightRail drawer="database" onDrawer={onDrawer} onError={onError}/>)
    expect(screen.getByText('SQL console')).toBeTruthy()
    expect(screen.getByText(/passwords nunca são persistidas/i)).toBeTruthy()
  })
})
