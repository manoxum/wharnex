export function registerBundlePickerIPC({
  ipcMain, trustedSender, sanitizeChatCacheKey,
  canonicalBundleFilename, dialog, app, path, readFile,
  MAX_EXECUTION_BUNDLE_BYTES, canonicalWharnexBundleDownload,
  validateWharnessBundleDownload,
}) {
  ipcMain.handle('wharness:chatgpt:pick-bundle', async (event, request) => {
    const windowState = trustedSender(event)
    const requestId = String(request?.requestId || '').trim()
    const chatId = request?.cacheKey ? sanitizeChatCacheKey(request.cacheKey) : ''
    const expectedFilename = canonicalBundleFilename(chatId || 'chat', requestId)
    const result = await dialog.showOpenDialog(windowState.window, {
      title: `Selecionar ${expectedFilename}`,
      defaultPath: app.getPath('downloads'),
      properties: ['openFile'],
      filters: [{ name: 'Wharnex bundle ZIP', extensions: ['zip'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
    const filePath = result.filePaths[0]
    const sourceFilename = path.basename(filePath)
    const bytes = await readFile(filePath)
    if (bytes.byteLength > MAX_EXECUTION_BUNDLE_BYTES) throw new Error('Bundle Wharnex excede o limite de 16 MiB.')
    const candidate = canonicalWharnexBundleDownload(sourceFilename, requestId, 'application/zip')
    if (!candidate) throw new Error('O ficheiro selecionado não é um bundle ZIP Wharnex reconhecível.')
    const validated = validateWharnessBundleDownload(candidate.filename, bytes)
    if (validated.requestId !== requestId) throw new Error('O bundle selecionado não pertence ao pedido ativo.')
    return {
      cancelled: false,
      filename: candidate.filename,
      requestId: validated.requestId,
      sourceFilename,
      normalizedFilename: candidate.normalized,
      bytes: bytes.byteLength,
      contentBase64: bytes.toString('base64'),
    }
  })
}
