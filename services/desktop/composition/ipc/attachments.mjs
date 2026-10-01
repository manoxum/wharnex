export function registerAttachmentsDomainIPC(common, context) {
  const { ipcMain, trustedSender } = common
  const {
    registerChatAttachmentIPC, shell, fetchChatTransportLimits,
    decodeChatAttachmentSet, chatAttachmentRoot, createPersistentAttachmentPreview,
  } = context
  registerChatAttachmentIPC({
    ipcMain, trustedSender, shell, fetchChatTransportLimits,
    decodeChatAttachmentSet, chatAttachmentRoot, createPersistentAttachmentPreview,
  })
}
