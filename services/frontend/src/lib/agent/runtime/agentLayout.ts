export const AGENT_SPLITTER_PX = 6
export const AGENT_CHAT_MIN_PX = 480
export const AGENT_INSPECTOR_MIN_PX = 400

export function boundedAgentChatWidth(width: number, workspaceWidth: number) {
  const available = Math.max(0, workspaceWidth - AGENT_SPLITTER_PX)
  if (available < AGENT_CHAT_MIN_PX + AGENT_INSPECTOR_MIN_PX) return 0
  const preferred = width > 0 ? width : Math.round(available * .6)
  return Math.round(Math.max(AGENT_CHAT_MIN_PX, Math.min(available - AGENT_INSPECTOR_MIN_PX, preferred)))
}
