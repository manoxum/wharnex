import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InstanceBadge } from './InstanceBadge'
import { instanceHue } from './instanceBadgeHue'

describe('InstanceBadge', () => {
  it('renders the configured instance with project version and a deterministic color', () => {
    render(<InstanceBadge instanceID="legacy" version=" v1.2.46.13 " />)

    const badge = screen.getByLabelText('Instância: legacy · versão v1.2.46.13')
    expect(badge.getAttribute('style')).toContain(`--instance-hue: ${instanceHue('legacy')}deg`)
    expect(badge.textContent).toBe('legacy · v1.2.46.13')
    expect(instanceHue('legacy')).not.toBe(instanceHue('continuous developing'))
  })

  it('keeps the instance visible when version metadata is unavailable', () => {
    render(<InstanceBadge instanceID="legacy" />)
    expect(screen.getByLabelText('Instância: legacy').textContent).toBe('legacy')
  })

  it('stays hidden when no instance identifier was configured', () => {
    const { container } = render(<InstanceBadge version="v1.2.46.13" />)
    expect(container.innerHTML).toBe('')
  })
})
