import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataSettings } from './DataSettings'

describe('data administration controls', () => {
  it('requires the exact reset phrase and keeps browser actions unavailable without Desktop', () => {
    const reset = vi.fn(), exportSession = vi.fn()
    const props = { busy: false, canManageBrowser: false, retentionDays: 30, bundleLimit: 80, confirmation: '', onRetention: vi.fn(), onBundleLimit: vi.fn(), onConfirmation: vi.fn(), onSaveRetention: vi.fn(), onSaveQuota: vi.fn(), onRefresh: vi.fn(), onExport: exportSession, onImport: vi.fn(), onClearSession: vi.fn(), onReset: reset }
    const view = render(<DataSettings {...props}/>)
    expect(screen.getAllByText('—')).toHaveLength(7)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar tudo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(reset).not.toHaveBeenCalled()
    expect(exportSession).not.toHaveBeenCalled()
    view.rerender(<DataSettings {...props} confirmation="APAGAR WHARNEX"/>)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar tudo' }))
    expect(reset).toHaveBeenCalledTimes(1)
    view.rerender(<DataSettings {...props} confirmation="APAGAR WHARNEX" busy/>)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar tudo' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
