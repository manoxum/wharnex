import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopBridge } from '../lib/desktop'
import { MessageAttachmentCard } from './ChatAttachmentCard'

const preview = vi.fn()
const read = vi.fn()
const open = vi.fn()

vi.mock('../lib/desktop', () => ({
  desktopBridge: vi.fn(),
  formatBytes: (bytes: number) => `${bytes} B`,
}))

vi.mock('../lib/artifactIndexing', () => ({ requestArtifactIndex: vi.fn() }))

vi.mock('./ArtifactViewerModal', () => ({
  ArtifactViewerModal: ({ directURL, items }: { directURL?: string; items: Array<{ path: string }> }) => <div role="dialog" aria-label="Visualizador de anexo"><span>{directURL}</span><b>{items[0]?.path}</b></div>,
}))

describe('MessageAttachmentCard', () => {
  beforeEach(() => {
    preview.mockReset()
    read.mockReset()
    open.mockReset()
    read.mockResolvedValue({ available: true, name: 'report.pdf', size: 9, mime: 'application/pdf', contentBase64: 'JVBERi0xLjQ=' })
    vi.mocked(desktopBridge).mockReturnValue({ attachments: { preview, read, open } } as any)
  })

  it('opens a persisted attachment in the Wharnex viewer instead of the operating-system opener', async () => {
    render(<MessageAttachmentCard attachment={{ name: 'report.pdf', size: 9, mime: 'application/pdf', storageRef: 'chat/message/0', previewKind: 'none' }}/>)

    fireEvent.click(screen.getByTitle('Abrir report.pdf no visualizador do Wharnex'))

    await waitFor(() => expect(read).toHaveBeenCalledWith({ storageRef: 'chat/message/0' }))
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Visualizador de anexo' })).toBeTruthy()
    expect(screen.getByText('data:application/pdf;base64,JVBERi0xLjQ=')).toBeTruthy()
    expect(screen.getByText('report.pdf')).toBeTruthy()
  })
})
