import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../../lib/transport/http/api'
import { confirmDialog } from '../../../../lib/desktop/bridge/appDialog'
import type { ProjectConfig, Session } from '../../../../types'
import { ProjectSettings } from '../ProjectSettings'

vi.mock('../../../../lib/desktop/bridge/appDialog', () => ({ confirmDialog: vi.fn(async () => false), noticeDialog: vi.fn() }))
const config: ProjectConfig = { version: 1, project: { name: 'atlas' }, context: { auto_exclude: true, max_file_bytes: 2097152, include: [], exclude: [] } }
const session: Session = { id: 'settings-draft', project_path: '/project', state: 'ready', execution_mode: 'protected', automation_mode: 'manual', created_at: '2026-10-15T10:00:00Z', context: { id: 'context', manifest: { id: 'context', project_root: '/project', sha256: 'fixture', files: [], excluded: [], text_truncated: false } } }
afterEach(() => vi.restoreAllMocks())
describe('context draft ownership', () => {
  it('shows pending changes, keeps a rejected close open, and clears the draft only after a successful save', async () => {
    vi.spyOn(api, 'projectConfig').mockResolvedValue(config)
    vi.spyOn(api, 'contextInspection').mockResolvedValue({ snapshot_id: 'context', sha256: 'fixture', project_root: '/project', included_files: 0, excluded_items: 0, included_bytes: 0, roots: [], entries: [], rules: [] })
    const update = vi.spyOn(api, 'updateProjectConfig').mockImplementation(async (...args) => ({ config: args[1], session }))
    const close = vi.fn()
    render(<ProjectSettings session={session} onClose={close} onError={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', { name: /Contexto/ }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Reconhecimento automático/ }))
    expect(screen.getByText('Alterações por guardar')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1))
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar e reconstruir contexto' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(session.id, { ...config, context: { ...config.context, auto_exclude: false, include_overrides: [] } }))
    await waitFor(() => expect(screen.queryByText('Alterações por guardar')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    expect(confirmDialog).toHaveBeenCalledTimes(1)
  })
})
