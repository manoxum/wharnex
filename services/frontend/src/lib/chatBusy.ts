export function activeChatBusy({
  activeChatId,
  busyChats,
  globalBusy,
  globalBusyOwnerChatId,
}: {
  activeChatId: string
  busyChats: Record<string, boolean>
  globalBusy: boolean
  globalBusyOwnerChatId: string
}) {
  if (busyChats[activeChatId]) return true
  return globalBusy && (!globalBusyOwnerChatId || globalBusyOwnerChatId === activeChatId)
}
