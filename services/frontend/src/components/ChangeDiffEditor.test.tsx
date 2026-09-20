import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChangeDiffEditor } from './ChangeDiffEditor'

vi.mock('../lib/api', () => ({ api: { readFile: vi.fn(() => new Promise(() => undefined)) } }))
vi.mock('../lib/uiPreferences', () => ({ subscribeUIPreferences: vi.fn(() => vi.fn()) }))
vi.mock('../lib/monaco', () => ({
  activeMonacoTheme: vi.fn(() => 'wharness-dark'),
  configureMonaco: vi.fn(),
  monaco: { editor: { setTheme: vi.fn() } },
}))

describe('ChangeDiffEditor', () => {
  it('keeps before and after context visible while the comparison loads', () => {
    render(<ChangeDiffEditor sessionId="ses-self" file={{
      path: 'src/demo.ts',
      additions: 1,
      deletions: 1,
      diff: 'diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-old\n+new\n',
    }}/>)

    const legend = screen.getByRole('group', { name: 'Comparação antes e depois' })
    expect(legend.textContent).toContain('Antes')
    expect(legend.textContent).toContain('Versão anterior')
    expect(legend.textContent).toContain('Depois')
    expect(legend.textContent).toContain('Versão aplicada')
    expect(screen.getByText('A preparar comparação…')).toBeTruthy()
  })
})
