import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { setLocalePreference, formatMessage } from './index'
import { WorkspaceSettings } from '../../../components/project/settings/environment/WorkspaceSettings'
import { BundleLimitsSettings } from '../../../components/project/settings/environment/BundleLimitsSettings'
import { ContextSettingsState } from '../../../components/project/settings/presentation/ContextSettingsState'

it('renders English workspace and context controls without changing paths or errors', () => {
  setLocalePreference('en')
  const save = vi.fn()
  render(<><WorkspaceSettings directory="/home/Guardar" onDirectory={vi.fn()} canBrowse onBrowse={vi.fn()} onSave={save} onClear={vi.fn()}/><ContextSettingsState error="O ficheiro Guardar não está disponível" onRetry={vi.fn()}/></>)
  expect(screen.getByRole('textbox', { name: 'Default workspace' }).getAttribute('value')).toBe('/home/Guardar')
  expect(screen.getByText('Could not load configuration')).toBeTruthy()
  expect(screen.getByText('O ficheiro Guardar não está disponível')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save workspace' }))
  expect(save).toHaveBeenCalledOnce()
})

it('localizes bundle field labels and units while retaining numeric settings', () => {
  setLocalePreference('en')
  const change = vi.fn()
  render(<BundleLimitsSettings value={{ attachments: 0, totalMiB: 100, partMiB: 30, parts: 10 }} onChange={change} busy={false} onSave={vi.fn()}/>)
  expect(screen.getByRole('spinbutton', { name: 'Total bundle size' }).getAttribute('value')).toBe('100')
  expect(screen.getByText('parts')).toBeTruthy()
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Maximum bundles per request' }), { target: { value: '12' } })
  expect(change).toHaveBeenCalledWith({ parts: 12 })
  expect(formatMessage('Eliminar definitivamente "{title}"? Esta ação não pode ser desfeita.', { title: 'Guardar {open}' })).toBe('Permanently delete "Guardar {open}"? This cannot be undone.')
})
