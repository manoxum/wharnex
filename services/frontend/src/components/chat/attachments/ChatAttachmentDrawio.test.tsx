import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerAttachmentChip, MessageAttachmentCard } from './ChatAttachmentCard'

const drawio = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="node" value="Servico" vertex="1" parent="1"><mxGeometry x="20" y="30" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>'

function textResponse(text: string) {
  return { ok: true, status: 200, body: null, headers: { get: () => null }, text: async () => text } as unknown as Response
}

describe('Draw.io chat attachments', () => {
  const createObjectURL = vi.fn(() => 'blob:wharnex-drawio-attachment')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    delete window.wharnessDesktop
  })

  afterEach(() => {
    delete window.wharnessDesktop
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('previews a selected Draw.io file and keeps source and download local', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(drawio)))
    const file = new File([drawio], 'arquitetura.drawio', { type: 'application/xml' })
    const view = render(<ComposerAttachmentChip file={file} onRemove={() => undefined}/>)

    expect(view.container.querySelector('.attachment-visual em')?.textContent).toBe('DRAWIO')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir arquitetura.drawio no Wharnex' }))

    expect(await screen.findByRole('img', { name: 'Diagrama Draw.io: arquitetura.drawio' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Descarregar/ }).getAttribute('download')).toBe('arquitetura.drawio')
    fireEvent.click(screen.getByRole('button', { name: 'Ver source' }))
    await waitFor(() => expect(document.querySelector('.artifact-text-preview pre')?.textContent).toContain('<mxGraphModel>'))

    fireEvent.click(screen.getByRole('button', { name: 'Fechar anexo' }))
    expect(screen.queryByRole('dialog', { name: 'Abrir arquitetura.drawio' })).toBeNull()
    view.unmount()
  })

  it('rebuilds a persisted Draw.io attachment from storageRef without external open', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(drawio)))
    const preview = vi.fn().mockResolvedValue({ available: false, previewKind: 'icon' })
    const read = vi.fn().mockResolvedValue({ name: 'persistido.drawio', mime: 'application/xml', contentBase64: btoa(drawio) })
    const open = vi.fn()
    Object.defineProperty(window, 'wharnessDesktop', {
      configurable: true,
      value: { attachments: { preview, read, open } },
    })
    const view = render(<MessageAttachmentCard attachment={{
      name: 'persistido.drawio',
      size: drawio.length,
      mime: 'application/xml',
      storageRef: 'chat/message/drawio',
      previewKind: 'icon',
    }}/>)

    await waitFor(() => expect(preview).toHaveBeenCalledWith({ storageRef: 'chat/message/drawio' }))
    expect(view.container.querySelector('.attachment-visual em')?.textContent).toBe('DRAWIO')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir persistido.drawio no Wharnex' }))

    await waitFor(() => expect(read).toHaveBeenCalledWith({ storageRef: 'chat/message/drawio' }))
    expect(await screen.findByRole('img', { name: 'Diagrama Draw.io: persistido.drawio' })).toBeTruthy()
    expect(open).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar anexo' }))
    view.unmount()
  })

  it('keeps PDF preview and historical unavailable attachment behavior unchanged', () => {
    const pdf = new File(['%PDF'], 'manual.pdf', { type: 'application/pdf' })
    const pdfView = render(<ComposerAttachmentChip file={pdf} onRemove={() => undefined}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir manual.pdf no Wharnex' }))
    expect(screen.getByTitle('Pré-visualização de manual.pdf').tagName).toBe('IFRAME')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar anexo' }))
    pdfView.unmount()

    const historical = render(<MessageAttachmentCard attachment={{
      name: 'antigo.pdf',
      size: 4,
      mime: 'application/pdf',
      previewKind: 'none',
    }}/>)
    const unavailable = screen.getByTitle('antigo.pdf · anexo histórico sem cópia persistida') as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Abrir antigo.pdf' })).toBeNull()
    historical.unmount()
  })
})
