import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SignalCore } from './SignalCore'

describe('SignalCore', () => {
  it('exposes an accessible app mark when it is the only brand identifier', () => {
    render(<SignalCore size="compact" />)
    const mark = screen.getByRole('img', { name: 'Signal Core' })
    expect(mark.className).toContain('signal-core-compact')
    expect(mark.querySelectorAll('circle')).toHaveLength(3)
  })
})
