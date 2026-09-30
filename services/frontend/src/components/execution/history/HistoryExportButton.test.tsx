import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryExportButton } from './HistoryExportButton'

describe('HistoryExportButton', () => {
  it('exports without toggling the parent disclosure click', () => {
    const onExport = vi.fn()
    const onParentClick = vi.fn()
    render(<div onClick={onParentClick}><HistoryExportButton label="Exportar execução" onExport={onExport}/></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Exportar execução' }))
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
  })
})
