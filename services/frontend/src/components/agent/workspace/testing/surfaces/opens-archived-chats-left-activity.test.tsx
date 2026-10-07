import { props } from '../fixtures'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import '../setup'
it('opens archived chats from the left activity drawer', () => {
    const view = props()
    render(view.element)
    fireEvent.click(screen.getByRole('button', { name: 'Gestão de chats' }))
    expect(screen.getByRole('tab', { name: /Guardados/ }).querySelector('svg')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Arquivados/ }).querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Diagnóstico antigo')).toBeTruthy()
    fireEvent.click(screen.getByText('Diagnóstico antigo'))
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar chat' }))
    expect(view.onRestore).toHaveBeenCalledWith('arch-1')
  })
