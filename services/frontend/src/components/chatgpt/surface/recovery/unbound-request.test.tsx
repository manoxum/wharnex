import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatGPTDesktopPane } from '../ChatGPTDesktopPane'
import { bridge, props, state } from '../chatGPTDesktopPaneTestFixtures'

afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

it('Retomar pedido routes a restarted unbound first request to full archive delivery', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {}; unobserve() {} })
  const desktop = bridge()
  desktop.chatgpt.show = vi.fn().mockResolvedValue({ ...state, url: 'https://chatgpt.com/' })
  desktop.chatgpt.continueExpectedBundle = vi.fn().mockResolvedValue({ ok: false, reason: 'not_supervised' })
  window.wharnessDesktop = desktop
  const resend = vi.fn().mockResolvedValue(undefined)
  render(<ChatGPTDesktopPane {...props} sessionId="ses-1" pendingRequestId="req-1" onResendPendingRequest={resend} />)
  fireEvent.click(screen.getByRole('button', { name: 'Retomar pedido' }))
  await waitFor(() => expect(resend).toHaveBeenCalledWith('req-1'))
  expect(desktop.chatgpt.resumeExpectedBundle).not.toHaveBeenCalled()
  expect(desktop.chatgpt.continueExpectedBundle).toHaveBeenCalledTimes(1)
})
