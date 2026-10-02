import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UITestingDocument } from '../../../types'
import { UIConfigTab } from './UIConfigTab'

const doc: UITestingDocument = {
  project_id: '/workspace/demo', context_sha256: 'ctx', sync_status: 'ready', auto_run_changes: true,
  environments: [{ id: 'admin', name: 'Admin', url: 'https://admin.example.test', profiles: [{ id: 'administrator', label: 'Administrador', role: 'admin', configured: false }] }],
  tests: [], runs: [], guides: [],
}

describe('UIConfigTab', () => {
  it('keeps passwords masked and only passes them through the save action', () => {
    const onSave = vi.fn(async () => undefined)
    render(<UIConfigTab doc={doc} busy={false} onSave={onSave}/>)

    const username = screen.getByLabelText('Utilizador Administrador') as HTMLInputElement
    const password = screen.getByLabelText('Senha Administrador') as HTMLInputElement
    expect(password.type).toBe('password')
    fireEvent.change(username, { target: { value: 'alice@example.test' } })
    fireEvent.change(password, { target: { value: 'correct-horse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }))

    expect(onSave).toHaveBeenCalledWith({
      environment_id: 'admin', profile_id: 'administrator', url: 'https://admin.example.test', username: 'alice@example.test', password: 'correct-horse',
    })
  })
})
