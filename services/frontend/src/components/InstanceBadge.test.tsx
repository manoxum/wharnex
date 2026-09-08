import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InstanceBadge } from './InstanceBadge'
import { instanceHue } from './instanceBadgeHue'

describe('InstanceBadge', () => {
  it('renders a configured instance with a deterministic color', () => {
    render(<InstanceBadge instanceID="legacy" />)

    expect(screen.getByLabelText('Instância: legacy').getAttribute('style')).toContain(`--instance-hue: ${instanceHue('legacy')}deg`)
    expect(instanceHue('legacy')).not.toBe(instanceHue('continuous developing'))
  })

  it('stays hidden when no instance identifier was configured', () => {
    const { container } = render(<InstanceBadge />)
    expect(container.innerHTML).toBe('')
  })
})
