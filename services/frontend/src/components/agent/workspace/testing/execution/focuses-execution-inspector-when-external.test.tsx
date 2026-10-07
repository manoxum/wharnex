import { props } from '../fixtures'
import { render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import '../setup'
it('focuses the execution inspector when an external recovery action requests logs', async () => {
    const view = props()
    const rendered = render(view.element)
    rendered.rerender(<view.Harness recoveryTab="terminal" />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Execução' }).getAttribute('aria-selected')).toBe('true'))
  })
