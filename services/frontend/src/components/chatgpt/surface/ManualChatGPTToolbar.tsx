import { useRef, useState } from 'react'
import { requestIdFromBundleName } from '../../../lib/artifacts/bundles/bundlename'
import { desktopBridge, formatBytes } from '../../../lib/desktop/bridge/desktop'
import { Icon } from '../../presentation/chrome/Icon'

const manualActionClass = 'grid size-8 shrink-0 place-items-center rounded-lg border border-whx-border-soft bg-whx-surface text-whx-soft shadow-[0_1px_2px_var(--theme-shadow)] transition-[transform,background-color,border-color,color,box-shadow] duration-150 hover:-translate-y-px hover:border-whx-border hover:bg-whx-hover hover:text-whx-text hover:shadow-[0_5px_14px_var(--theme-shadow)] active:translate-y-0 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whx-accent disabled:pointer-events-none disabled:opacity-35 disabled:shadow-none'
const manualPrimaryActionClass = 'grid size-8 shrink-0 place-items-center rounded-lg border border-whx-accent/45 bg-whx-accent-soft text-whx-accent shadow-[0_1px_2px_var(--theme-shadow)] transition-[transform,background-color,border-color,color,box-shadow,filter] duration-150 hover:-translate-y-px hover:border-whx-accent hover:brightness-110 hover:shadow-[0_6px_18px_var(--theme-shadow)] active:translate-y-0 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whx-accent disabled:pointer-events-none disabled:opacity-35 disabled:shadow-none'

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

  const bundleCopyLabel = `Copiar bundle${manualInput && manualInput.filenames.length > 1 ? 's' : ''}`

  return <div className="border-b border-whx-border bg-whx-bg px-2.5 py-2 text-whx-text" data-testid="manual-chatgpt-toolbar">
    <div className="rounded-2xl border border-whx-border bg-whx-elevated p-1.5 shadow-[0_8px_24px_var(--theme-shadow)]">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-whx-warning/25 bg-whx-surface px-2 py-1">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-whx-warning/20 bg-whx-warning/10 text-whx-warning"><Icon name="cursor" size={13}/></span>
          <div className="min-w-0 leading-tight">
            <span className="block text-xs font-semibold text-whx-text">Manual · sem scraper</span>
            <span className="block truncate text-[10px] text-whx-faint">Handoff controlado pelo utilizador</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-whx-border-soft bg-whx-bg/70 p-1 shadow-[inset_0_1px_0_var(--theme-shadow)]">
          <button type="button" className={manualActionClass} title="Copiar prompt" aria-label="Copiar prompt" disabled={!preparedPrompt || busy} onClick={() => void copyPrompt()}><Icon name="copy" size={14}/></button>
          <button type="button" className={manualActionClass} title={bundleCopyLabel} aria-label={bundleCopyLabel} disabled={!manualInput || busy} onClick={() => void copyBundles()}><Icon name="archive" size={14}/></button>
          <button type="button" className={manualActionClass} title="Colar no foco" aria-label="Colar no foco" disabled={!bridge || busy} onClick={() => void bridge?.chatgpt.paste(chatId)}><Icon name="clipboard" size={14}/></button>
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-whx-border-soft" />
          <button type="button" className={manualPrimaryActionClass} title="Carregar resposta" aria-label="Carregar resposta" aria-controls="manual-chatgpt-response-importer" disabled={!responseRequestId || busy} aria-expanded={responseOpen} onClick={() => setResponseOpen((open) => !open)}><Icon name="download" size={14}/></button>
        </div>

        <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-whx-border-soft bg-whx-surface px-2.5 py-1.5 text-xs text-whx-soft" role="status" title={status}>
          <span className={`size-1.5 shrink-0 rounded-full ${manualInput ? 'bg-whx-success' : 'bg-whx-faint'}`} />
          <span className="truncate">{status}</span>
          {manualInput?.bytes ? <span className="shrink-0 font-mono text-[10px] text-whx-faint">{formatBytes(manualInput.bytes)}</span> : null}
        </span>
      </div>

      {manualInput?.error && <div className="mx-1 mt-1.5 rounded-lg border border-whx-danger/30 bg-whx-surface px-2.5 py-2 text-xs text-whx-danger">Picker: {manualInput.error}</div>}

      {responseOpen && <div id="manual-chatgpt-response-importer" className="mt-1.5 overflow-hidden rounded-xl border border-whx-border bg-whx-surface shadow-[0_12px_32px_var(--theme-shadow)]" role="dialog" aria-label="Carregar bundle de resposta">
        <div className="flex items-start justify-between gap-3 border-b border-whx-border-soft bg-whx-elevated px-3 py-2.5">
          <div className="min-w-0">
            <span className="block text-sm font-semibold">Importar resposta</span>
            <span className="mt-0.5 block text-xs text-whx-faint">Use o ZIP canónico devolvido pelo ChatGPT para concluir este pedido.</span>
          </div>
          <button type="button" className="grid size-7 shrink-0 place-items-center rounded-lg text-whx-soft transition hover:bg-whx-hover hover:text-whx-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whx-accent" aria-label="Fechar carregamento de resposta" onClick={() => setResponseOpen(false)}><Icon name="close" size={14}/></button>
        </div>

        <div className="p-2.5">
          <div ref={dropRef} className={`grid min-h-20 place-items-center rounded-xl border border-dashed px-4 py-3 text-center transition ${dragOver ? 'border-whx-accent bg-whx-accent-soft' : 'border-whx-border bg-whx-bg'}`} onDragOver={(event) => { event.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files?.[0]; if (file) void importResponse(file) }}>
            <div className="grid place-items-center gap-1.5">
              <span className="grid size-8 place-items-center rounded-lg bg-whx-accent-soft text-whx-accent"><Icon name="download" size={15}/></span>
              <span className="text-xs font-semibold">{uploading ? 'A importar…' : 'Arraste aqui o bundle de resposta'}</span>
              <span className="text-[10px] text-whx-faint">whx_bundle_res_…zip</span>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-whx-faint">O ficheiro é validado antes de entrar no pipeline do Wharnex.</span>
            <button type="button" className={manualPrimaryActionClass} disabled={uploading || busy} onClick={() => void pickResponse()}><Icon name="file" size={13}/> Selecionar ZIP</button>
          </div>
        </div>
      </div>}
    </div>
  </div>
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}
