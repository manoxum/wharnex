import type { Session } from '../../../types'
import type { WorkspaceChat } from '../../chat/history/workspaceMemory'
import { rememberCodexSelection, resolveCodexSelection } from '../preferences'

export async function dispatchNativeCodex(bridge: WharnessDesktopBridge, session: Session, chat: WorkspaceChat, text: string, attachments: DesktopUserAttachment[], projectFiles: string[], persistSelection?: (selection: ReturnType<typeof resolveCodexSelection>) => void) {
  if (!bridge.codex?.prepareNative) throw new Error('Atualize o Wharnex Desktop para usar Codex Native.')
  const selection = resolveCodexSelection(chat)
  const result = await bridge.codex.prepareNative({ projectPath: session.project_path, cacheKey: chat.id, sessionId: session.id,
    requestId: `req_native_${crypto.randomUUID().replaceAll('-', '')}`, text, chatTitle: chat.title,
    model: selection.codexModel, effort: selection.codexEffort, ...(chat.codexPermission ? { permissionLevel: chat.codexPermission } : {}), attachments, projectFiles })
  rememberCodexSelection(selection.codexModel, selection.codexEffort)
  persistSelection?.(selection)
  return result
}
