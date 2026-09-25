import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualChatGPTToolbar } from './ManualChatGPTToolbar'

function bridge() {
  return {
    chatgpt: {
      paste: vi.fn().mockResolvedValue({ ok: true }),
      copyPendingBundles: vi.fn().mockResolvedValue({ ok: true, count: 1, filenames: ['request.zip'] }),
      pickBundle: vi.fn().mockResolvedValue({ cancelled: true }),
    },
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  } as unknown as WharnessDesktopBridge
}

const state: DesktopChatGPTState = {
  url: 'https://chatgpt.com/c/abc', title: 'ChatGPT', loading: false, canGoBack: false, canGoForward: false,
  manualInput: { requestId: 'req_20260925T063245_be33c052e8a8b2e3', filenames: ['request.zip'], bytes: 1024, pickerArmed: true, pickerAttached: false, prompt: 'Read the attached request bundle.' },
}

describe('ManualChatGPTToolbar', () => {
  afterEach(() => { cleanup(); delete window.wharnessDesktop })

  it('copies the prepared bootstrap and pending request bundle and pastes into the focused ChatGPT input', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    render(<ManualChatGPTToolbar chatId="chat-a" manualPrompt="fallback" pendingRequestId={state.manualInput?.requestId} state={state} busy={false} onBundleFile={async () => ''} onNotice={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copiar prompt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copiar bundle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Colar no foco' }))

    await waitFor(() => expect(desktop.clipboard.writeText).toHaveBeenCalledWith('Read the attached request bundle.'))
    expect(desktop.chatgpt.copyPendingBundles).toHaveBeenCalledWith('chat-a', state.manualInput?.requestId)
    expect(desktop.chatgpt.paste).toHaveBeenCalledWith('chat-a')
    expect(screen.getByText(/Picker automático armado/)).toBeTruthy()
  })

  it('imports a response bundle dropped on the popup', async () => {
    const desktop = bridge(); window.wharnessDesktop = desktop
    const onBundleFile = vi.fn<(contentBase64: string, requestId: string, filename: string) => Promise<string>>(async () => 'Bundle importado')
    const onNotice = vi.fn()
    render(<ManualChatGPTToolbar chatId="chat-a" manualPrompt="fallback" pendingRequestId={state.manualInput?.requestId} state={state} busy={false} onBundleFile={onBundleFile} onNotice={onNotice} />)

    fireEvent.click(screen.getByRole('button', { name: 'Carregar resposta' }))
    const dialog = screen.getByRole('dialog', { name: 'Carregar bundle de resposta' })
    const file = new File(['zip-bytes'], `whx_bundle_res_chat-a_${state.manualInput?.requestId}.zip`, { type: 'application/zip' })
    fireEvent.drop(dialog.querySelector('.border-dashed') as HTMLElement, { dataTransfer: { files: [file] } })

    await waitFor(() => expect(onBundleFile).toHaveBeenCalledTimes(1))
    expect(onBundleFile.mock.calls[0][1]).toBe(state.manualInput?.requestId)
    expect(onNotice).toHaveBeenCalledWith('Bundle importado')
  })
})
