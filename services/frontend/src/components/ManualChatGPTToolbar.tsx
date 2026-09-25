import { useRef, useState } from 'react'
import { requestIdFromBundleName } from '../lib/bundlename'
import { desktopBridge, formatBytes } from '../lib/desktop'
import { Icon } from './Icon'

type ManualInputState = {
  requestId: string
  filenames: string[]
  bytes: number
  pickerArmed: boolean
  pickerAttached: boolean
  error?: string
  prompt?: string
}

export function ManualChatGPTToolbar({ chatId, manualPrompt, pendingRequestId, state, busy, onBundleFile, onNotice }: {
  chatId: string
  manualPrompt: string
  pendingRequestId?: string
  state: DesktopChatGPTState
  busy: boolean
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
  onNotice: (message: string) => void
}) {
  const bridge = desktopBridge()
  const [responseOpen, setResponseOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const manualInput = (state as DesktopChatGPTState & { manualInput?: ManualInputState }).manualInput
  const responseRequestId = pendingRequestId || manualInput?.requestId || ''
  const preparedPrompt = manualInput?.prompt || manualPrompt

  async function copyPrompt() {
    if (!preparedPrompt) return
    try {
      if (bridge?.clipboard.writeText) await bridge.clipboard.writeText(preparedPrompt)
      else await navigator.clipboard.writeText(preparedPrompt)
      onNotice('Prompt copiado para a área de transferência.')
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Não foi possível copiar o prompt.') }
  }

  async function copyBundles() {
    if (!bridge || !manualInput) return
    try {
      const result = await bridge.chatgpt.copyPendingBundles(chatId, manualInput.requestId)
      onNotice(`${result.count} bundle${result.count === 1 ? '' : 's'} copiado${result.count === 1 ? '' : 's'} para a área de transferência.`)
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Não foi possível copiar o bundle pendente.') }
  }

  async function importResponse(file: File) {
    const requestId = requestIdFromBundleName(file.name)
    if (!requestId) { onNotice(`Bundle de resposta não reconhecido: ${file.name}`); return }
    if (responseRequestId && requestId !== responseRequestId) { onNotice('O bundle selecionado pertence a outro pedido.'); return }
    setUploading(true)
    try {
      const contentBase64 = arrayBufferToBase64(await file.arrayBuffer())
      onNotice(await onBundleFile(contentBase64, requestId, file.name) || 'Bundle de resposta importado.')
      setResponseOpen(false)
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)) }
    finally { setUploading(false) }
  }

  async function pickResponse() {
    if (!bridge || !responseRequestId) return
    try {
      const picked = await bridge.chatgpt.pickBundle({ requestId: responseRequestId })
      if (!picked.cancelled && picked.contentBase64 && picked.requestId && picked.filename) {
        onNotice(await onBundleFile(picked.contentBase64, picked.requestId, picked.filename) || 'Bundle de resposta importado.')
        setResponseOpen(false)
      }
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)) }
  }

  const status = manualInput?.pickerAttached ? 'Bundle anexado pelo picker' : manualInput?.pickerArmed ? 'Picker automático armado' : manualInput ? 'Bundle pendente preparado' : 'Sem bundle pendente'

  return <div className="border-b border-whx-border bg-whx-elevated px-2 py-2 text-whx-text" data-testid="manual-chatgpt-toolbar">
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1 rounded-md border border-whx-warning bg-whx-muted px-2 py-1 text-xs font-semibold text-whx-warning"><Icon name="cursor" size={13}/> Manual · sem scraper</span>
      <button type="button" className="inline-flex items-center gap-1 rounded-md border border-whx-border bg-whx-surface px-2 py-1 text-xs hover:bg-whx-hover disabled:opacity-50" disabled={!preparedPrompt || busy} onClick={() => void copyPrompt()}><Icon name="copy" size={13}/> Copiar prompt</button>
      <button type="button" className="inline-flex items-center gap-1 rounded-md border border-whx-border bg-whx-surface px-2 py-1 text-xs hover:bg-whx-hover disabled:opacity-50" disabled={!manualInput || busy} onClick={() => void copyBundles()}><Icon name="archive" size={13}/> Copiar bundle{manualInput && manualInput.filenames.length > 1 ? 's' : ''}</button>
      <button type="button" className="inline-flex items-center gap-1 rounded-md border border-whx-border bg-whx-surface px-2 py-1 text-xs hover:bg-whx-hover disabled:opacity-50" disabled={!bridge || busy} onClick={() => void bridge?.chatgpt.paste(chatId)}><Icon name="clipboard" size={13}/> Colar no foco</button>
      <button type="button" className="inline-flex items-center gap-1 rounded-md border border-whx-border bg-whx-surface px-2 py-1 text-xs hover:bg-whx-hover disabled:opacity-50" disabled={!responseRequestId || busy} onClick={() => setResponseOpen((open) => !open)}><Icon name="download" size={13}/> Carregar resposta</button>
      <span className="ml-auto text-xs text-whx-soft">{status}{manualInput?.bytes ? ` · ${formatBytes(manualInput.bytes)}` : ''}</span>
    </div>
    {manualInput?.error && <div className="mt-2 text-xs text-whx-danger">Picker: {manualInput.error}</div>}
    {responseOpen && <div className="mt-2 rounded-lg border border-whx-border bg-whx-surface p-2" role="dialog" aria-label="Carregar bundle de resposta">
      <div className="flex items-center justify-between gap-2"><div><strong className="text-sm">Bundle de resposta</strong><div className="text-xs text-whx-soft">Selecione o ZIP ou arraste-o para esta zona.</div></div><button type="button" className="text-whx-soft hover:text-whx-text" aria-label="Fechar carregamento de resposta" onClick={() => setResponseOpen(false)}><Icon name="close" size={15}/></button></div>
      <div ref={dropRef} className={`mt-2 flex min-h-16 items-center justify-center rounded-md border border-dashed px-3 text-center text-xs ${dragOver ? 'border-whx-accent bg-whx-accent-soft' : 'border-whx-border bg-whx-bg'}`} onDragOver={(event) => { event.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files?.[0]; if (file) void importResponse(file) }}><span>{uploading ? 'A importar…' : 'Arraste aqui o whx_bundle_res_…zip'}</span></div>
      <button type="button" className="mt-2 inline-flex items-center gap-1 rounded-md border border-whx-border bg-whx-elevated px-2 py-1 text-xs hover:bg-whx-hover disabled:opacity-50" disabled={uploading || busy} onClick={() => void pickResponse()}><Icon name="file" size={13}/> Selecionar ZIP</button>
    </div>}
  </div>
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}
