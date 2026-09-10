import type { WorkspaceChat } from './workspaceMemory'

// How many chats keep a live ChatGPT pane.
//
// Small on purpose: every pane owns bridge subscriptions and re-renders on
// remote state, so mounting one per chat made the cost grow with the chat count
// rather than with what the user is actually using. A workspace that grew to
// thirty chats blocked the renderer's main thread while a ChatGPT surface
// loaded — the window went unresponsive and was then killed and restarted in a
// loop. A background chat's supervision is driven from the desktop main
// process, not from its pane being mounted, so this costs no observability.
export const MAX_RESIDENT_CHAT_PANES = 4

/**
 * The bounded set of chats that keep a mounted pane: the active chat, which is
 * never evicted however old it is, plus the most recently used others. A chat
 * outside the window simply mounts its pane when it is next opened.
 *
 * Order is left untouched while everything fits, so the common case keeps a
 * stable render order.
 */
export function residentPoolChats(chats: WorkspaceChat[], activeChatId: string): WorkspaceChat[] {
  if (chats.length <= MAX_RESIDENT_CHAT_PANES) return chats
  const active = chats.filter((chat) => chat.id === activeChatId)
  const rest = chats
    .filter((chat) => chat.id !== activeChatId)
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return [...active, ...rest].slice(0, MAX_RESIDENT_CHAT_PANES)
}
