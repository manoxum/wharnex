import { props } from '../fixtures'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import '../setup'
it('exports the active chat from the fixed chat header', () => {
    const view = props()
    render(view.element)
    const exportButton = screen.getByRole('button', { name: 'Exportar ZIP' })
    expect((exportButton as HTMLButtonElement).disabled).toBe(false)
    expect(exportButton.textContent).toBe('')
    expect(exportButton.closest('header')?.className).toContain('chat-header')
    expect(exportButton.closest('.chat-header-context')).toBeTruthy()
    expect(exportButton.closest('.agent-activity-bar')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Principal' })).toBeNull()
    expect(screen.getByRole('tab', { name: /^Principal$/ })).toBeTruthy()
    fireEvent.click(exportButton)
    expect(view.onExportChat).toHaveBeenCalledTimes(1)
  })
