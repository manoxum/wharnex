import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerAttachmentChip, MessageAttachmentCard } from './ChatAttachmentCard'

describe('chat attachment internal viewer', () => {
  const createObjectURL = vi.fn(() => 'blob:wharnex-attachment')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    delete window.wharnessDesktop
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('opens a composer attachment inside Wharnex and keeps remove separate', () => {
    const onRemove = vi.fn()
    const file = new File([new Uint8Array([1, 2, 3])], 'screen.png', { type: 'image/png' })
    render(<ComposerAttachmentChip file={file} onRemove={onRemove}/>)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir screen.png no Wharnex' }))

    expect(screen.getByRole('dialog', { name: 'Abrir screen.png' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Descarregar/ }).getAttribute('download')).toBe('screen.png')
    expect(onRemove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar anexo' }))
    expect(screen.queryByRole('dialog', { name: 'Abrir screen.png' })).toBeNull()
  })

  it('reads persisted timeline attachments into the internal viewer without shell open', async () => {
    const preview = vi.fn().mockResolvedValue({ available: true, dataUrl: 'data:image/png;base64,AQ==', previewKind: 'thumbnail' })
    const read = vi.fn().mockResolvedValue({ name: 'evidence.png', mime: 'image/png', contentBase64: 'AQID' })
    const open = vi.fn()
    Object.defineProperty(window, 'wharnessDesktop', {
      configurable: true,
      value: { attachments: { preview, read, open } },
    })
    render(<MessageAttachmentCard attachment={{ name: 'evidence.png', size: 3, mime: 'image/png', storageRef: 'chat/message/0', previewKind: 'thumbnail' }}/>)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir evidence.png no Wharnex' }))

    await waitFor(() => expect(read).toHaveBeenCalledWith({ storageRef: 'chat/message/0' }))
    expect(screen.getByRole('dialog', { name: 'Abrir evidence.png' })).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
  })
})
