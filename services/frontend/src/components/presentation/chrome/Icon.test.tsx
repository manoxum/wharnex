import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon } from './Icon'

describe('Icon', () => {
  it('renders the shared Lucide stroke and size contract for product symbols', () => {
    const symbols = ['agent', 'chatgpt', 'git', 'workspace', 'search', 'terminal', 'network', 'graph'] as const
    const { container } = render(<>{symbols.map((name) => <Icon key={name} name={name} size={16}/>)}</>)
    const glyphs = [...container.querySelectorAll('svg')]

    expect(glyphs).toHaveLength(symbols.length)
    for (const glyph of glyphs) {
      expect(glyph.getAttribute('viewBox')).toBe('0 0 24 24')
      expect(glyph.getAttribute('stroke')).toBe('currentColor')
      expect(glyph.getAttribute('stroke-width')).toBe('2')
      expect(glyph.getAttribute('stroke-linecap')).toBe('round')
      expect(glyph.getAttribute('stroke-linejoin')).toBe('round')
      expect(glyph.getAttribute('width')).toBe('16')
      expect(glyph.getAttribute('aria-hidden')).toBe('true')
    }
    expect(glyphs[0].innerHTML).not.toBe(glyphs[1].innerHTML)
    expect(glyphs[6].innerHTML).not.toBe(glyphs[7].innerHTML)
  })
})
