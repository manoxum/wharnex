import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { setLocalePreference } from '../../../../lib/workspace/localization'
import { TaskOverview } from './TaskOverview'

it('keeps attention styling and source identifiers independent of the interface language', () => {
  setLocalePreference('en')
  const onSource = vi.fn()
  const onQuery = vi.fn()
  render(<TaskOverview counts={{ queue: 4, completed: 2 }} runningCount={1} attentionCount={1} query="" source="all" onQuery={onQuery} onSource={onSource} onClose={vi.fn()}/>)
  expect(screen.getByText('Attention').parentElement?.className).toContain('text-whx-danger')
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter tasks by source' }), { target: { value: 'translation' } })
  expect(onSource).toHaveBeenCalledWith('translation')
  fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'Guardar' } })
  expect(onQuery).toHaveBeenCalledWith('Guardar')
})
