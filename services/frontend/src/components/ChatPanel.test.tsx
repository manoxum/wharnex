import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from './ChatPanel'
import type { Session } from '../types'

const session = {
  id: 'ses-test',
  project_path: '/tmp/demo',
  state: 'ready',
  created_at: new Date().toISOString(),
  context: {
    id: 'ctx-test',
    manifest: {
      id: 'ctx-test',
      project_root: '/tmp/demo',
      sha256: 'abcdef1234567890',
      files: [],
      excluded: [],
      text_truncated: false,
    },
  },
} satisfies Session

describe('ChatPanel', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not return scrollIntoView result as an effect cleanup', () => {
    const scrollIntoView = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    const view = render(
      <ChatPanel session={session} items={[]} busy={false} onSend={async () => undefined} />,
    )

    expect(scrollIntoView).toHaveBeenCalled()
    expect(() => view.unmount()).not.toThrow()
  })
})
