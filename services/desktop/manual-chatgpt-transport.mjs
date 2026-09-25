import { pathToFileURL } from 'node:url'

export function createManualChatGPTTransport({ clipboard, ClipboardItem, onStateChange = () => {} }) {
  const pending = new Map()
  const chooserBindings = new Map()

  function publicState(cacheKey) {
    const record = pending.get(cacheKey)
    if (!record) return undefined
    return {
      requestId: record.requestId,
      filenames: record.filenames.slice(),
      bytes: record.bytes,
      pickerArmed: chooserBindings.has(cacheKey),
      pickerAttached: record.pickerAttached === true,
      error: record.error || '',
      prompt: record.prompt || '',
    }
  }

  async function disarm(cacheKey) {
    const binding = chooserBindings.get(cacheKey)
    if (!binding) return false
    chooserBindings.delete(cacheKey)
    const { wc, handler, ownsDebugger } = binding
    try { wc.debugger.removeListener('message', handler) } catch { /* already gone */ }
    try { if (wc.debugger.isAttached()) await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }) } catch { /* surface closed */ }
    if (ownsDebugger) try { if (wc.debugger.isAttached()) wc.debugger.detach() } catch { /* already detached */ }
    onStateChange(cacheKey)
    return true
  }

  async function arm(cacheKey, wc) {
    await disarm(cacheKey)
    const record = pending.get(cacheKey)
    if (!record || !record.files.length || !wc || wc.isDestroyed?.()) return false
    let ownsDebugger = false
    try {
      if (!wc.debugger.isAttached()) { wc.debugger.attach('1.3'); ownsDebugger = true }
      const handler = (_event, method, params) => {
        if (method !== 'Page.fileChooserOpened') return
        void (async () => {
          const current = pending.get(cacheKey)
          if (!current) return
          try {
            await wc.debugger.sendCommand('DOM.setFileInputFiles', { backendNodeId: params?.backendNodeId, files: current.files })
            current.pickerAttached = true
            current.error = ''
          } catch (error) {
            current.error = error instanceof Error ? error.message : String(error)
          } finally {
            await disarm(cacheKey)
            onStateChange(cacheKey)
          }
        })()
      }
      wc.debugger.on('message', handler)
      await wc.debugger.sendCommand('Page.enable')
      await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
      chooserBindings.set(cacheKey, { wc, handler, ownsDebugger })
      record.error = ''
      onStateChange(cacheKey)
      return true
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error)
      if (ownsDebugger) try { if (wc.debugger.isAttached()) wc.debugger.detach() } catch { /* already detached */ }
      onStateChange(cacheKey)
      return false
    }
  }

  async function prepare(cacheKey, input, wc) {
    pending.set(cacheKey, {
      requestId: String(input.requestId || ''),
      files: [...(input.files || [])],
      filenames: [...(input.filenames || [])],
      bytes: Number(input.bytes || 0),
      pickerAttached: false,
      error: '',
      prompt: String(input.prompt || ''),
    })
    await arm(cacheKey, wc)
    return publicState(cacheKey)
  }

  async function setMode(cacheKey, mode, wc) {
    if (mode === 'manual') return pending.has(cacheKey) ? arm(cacheKey, wc) : false
    return clear(cacheKey)
  }

  async function copyPendingBundles(cacheKey, requestId = '') {
    const record = pending.get(cacheKey)
    if (!record || !record.files.length) throw new Error('Não existe bundle de pedido pendente para copiar.')
    const expected = String(requestId || '').trim()
    if (expected && record.requestId !== expected) throw new Error('O bundle pendente pertence a outro pedido.')
    const uriList = `${record.files.map((file) => pathToFileURL(file).href).join('\r\n')}\r\n`
    await clipboard.write([new ClipboardItem({ 'text/uri-list': uriList })])
    return { ok: true, count: record.files.length, filenames: record.filenames.slice() }
  }

  async function clear(cacheKey, requestId = '') {
    const record = pending.get(cacheKey)
    if (!record) return false
    const expected = String(requestId || '').trim()
    if (expected && record.requestId !== expected) return false
    await disarm(cacheKey)
    pending.delete(cacheKey)
    onStateChange(cacheKey)
    return true
  }

  function release(cacheKey) {
    pending.delete(cacheKey)
    void disarm(cacheKey)
  }

  return { arm, clear, copyPendingBundles, prepare, publicState, release, setMode }
}
