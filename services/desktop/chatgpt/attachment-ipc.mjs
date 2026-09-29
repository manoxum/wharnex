import { sanitizeChatCacheKey } from '../security.mjs'
import {
  persistChatAttachmentFiles, readStoredAttachment, readStoredAttachmentPreview,
  removeStoredChatAttachments, storedAttachmentPath,
} from '../chat-attachment-store.mjs'

export function registerChatAttachmentIPC({
  ipcMain, trustedSender, shell, fetchChatTransportLimits,
  decodeChatAttachmentSet, chatAttachmentRoot, createPersistentAttachmentPreview,
}) {
  ipcMain.handle('wharness:attachments:persist', async (event, request) => {
    trustedSender(event)
    const cacheKey = sanitizeChatCacheKey(request?.cacheKey)
    const messageId = sanitizeChatCacheKey(request?.messageId)
    const limits = await fetchChatTransportLimits()
    const { decoded } = decodeChatAttachmentSet(request?.attachments || [], limits)
    const attachments = await persistChatAttachmentFiles(chatAttachmentRoot(), cacheKey, messageId, decoded, createPersistentAttachmentPreview)
    return { ok: true, attachments }
  })
  ipcMain.handle('wharness:attachments:preview', async (event, request) => {
    trustedSender(event)
    try { return await readStoredAttachmentPreview(chatAttachmentRoot(), request?.storageRef) }
    catch { return { available: false, dataUrl: '', previewKind: 'none' } }
  })
  ipcMain.handle('wharness:attachments:read', async (event, request) => {
    trustedSender(event)
    return readStoredAttachment(chatAttachmentRoot(), request?.storageRef)
  })
  ipcMain.handle('wharness:attachments:open', async (event, request) => {
    trustedSender(event)
    const filePath = await storedAttachmentPath(chatAttachmentRoot(), request?.storageRef)
    const error = await shell.openPath(filePath)
    if (error) throw new Error(`Não foi possível abrir o anexo: ${error}`)
    return { ok: true }
  })
  ipcMain.handle('wharness:attachments:remove-chat', async (event, request) => {
    trustedSender(event)
    const cacheKey = sanitizeChatCacheKey(request?.cacheKey)
    await removeStoredChatAttachments(chatAttachmentRoot(), cacheKey)
    return { ok: true }
  })
}
