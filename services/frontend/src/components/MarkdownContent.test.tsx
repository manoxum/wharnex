import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from './MarkdownContent'

describe('MarkdownContent', () => {
  it('renders headings, lists and fenced code instead of raw markdown text', () => {
    const { container } = render(<MarkdownContent markdown={'## Resumo\n\n- item\n\n```sh\nmake check\n```'} />)
    expect(container.querySelector('h2')?.textContent).toBe('Resumo')
    expect(container.querySelector('li')?.textContent).toBe('item')
    expect(container.querySelector('pre code')?.textContent).toContain('make check')
  })

  it('sanitizes embedded HTML before rendering plan content', () => {
    const { container } = render(<MarkdownContent markdown={'texto <script>window.bad = true</script> **seguro**'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('seguro')
  })
})
