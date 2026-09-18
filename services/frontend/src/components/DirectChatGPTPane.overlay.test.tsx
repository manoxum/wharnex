import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectChatGPTPane } from './DirectChatGPTPane'
import { directChatGPTKey } from '../lib/directChatGPT'

class TestResizeObserver { observe() {}; disconnect() {}; unobserve() {} }

function bridge() {
  const noopSubscription = () => () => undefined
  const state = {
    cacheKey: directChatGPTKey('/tmp/project'),
    url: 'https://chatgpt.com/',
    title: 'ChatGPT',
    loading: false,
    canGoBack: false,
    canGoForward: false,
  }
  return {
    chatgpt: {
      show: vi.fn().mockResolvedValue({ ok: true }),
      hide: vi.fn().mockResolvedValue({ ok: true }),
      setBounds: vi.fn().mockResolvedValue({ ok: true }),
      state: vi.fn().mockResolvedValue(state),
      onState: vi.fn(noopSubscription),
      back: vi.fn(),
      forward: vi.fn(),
      reload: vi.fn(),
      openExternal: vi.fn(),
    },
  } as unknown as WharnessDesktopBridge
}

describe('DirectChatGPTPane overlays', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', TestResizeObserver))
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

  it('does not expose a loading label when the native surface is already ready', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const { container } = render(<DirectChatGPTPane projectPath="/tmp/project" suspended />)
    await waitFor(() => expect(desktop.chatgpt.state).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('.direct-chatgpt-host')?.textContent).toBe(''))
  })

  it('hides the native view behind a trusted overlay and restores it afterwards', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<DirectChatGPTPane projectPath="/tmp/project" />)
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())

    const overlay = document.createElement('section')
    overlay.setAttribute('data-chatgpt-overlay-blocker', 'true')
    document.body.appendChild(overlay)
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalled())

    const before = vi.mocked(desktop.chatgpt.show).mock.calls.length
    overlay.remove()
    await waitFor(() => expect(vi.mocked(desktop.chatgpt.show).mock.calls.length).toBeGreaterThan(before))
  })
})
