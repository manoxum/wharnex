import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UITestDesignComposer } from './UITestDesignComposer'

const environments = [{ id: 'web', name: 'Aplicação web', profiles: [] }]

describe('UITestDesignComposer', () => {
  it('sends the brief with the chosen environment and closes', async () => {
    const onSubmit = vi.fn(async () => undefined)
    const onClose = vi.fn()
    render(<UITestDesignComposer environments={environments} busy={false} onClose={onClose} onSubmit={onSubmit}/>)
    const send = screen.getByRole('button', { name: /Desenhar teste/ }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'web' } })
    fireEvent.change(screen.getByLabelText('Descrição do teste'), { target: { value: '  Criar item duplicado e ver erro  ' } })
    fireEvent.click(send)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSubmit).toHaveBeenCalledWith({ brief: 'Criar item duplicado e ver erro', environment_id: 'web' })
  })

  it('keeps the draft when sending fails', async () => {
    const onClose = vi.fn()
    render(<UITestDesignComposer environments={environments} busy={false} onClose={onClose} onSubmit={vi.fn(async () => { throw new Error('offline') })}/>)
    fireEvent.change(screen.getByLabelText('Descrição do teste'), { target: { value: 'Login público' } })
    fireEvent.keyDown(screen.getByLabelText('Descrição do teste'), { key: 'Enter', ctrlKey: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Descrição do teste') as HTMLTextAreaElement).value).toBe('Login público')
  })
})
