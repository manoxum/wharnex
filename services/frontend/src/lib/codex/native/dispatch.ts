import type { Session } from '../../../types'
import type { WorkspaceChat } from '../../chat/history/workspaceMemory'

export async function dispatchNativeCodex(bridge: WharnessDesktopBridge, session: Session, chat: WorkspaceChat, text: string, attachments: DesktopUserAttachment[], projectFiles: string[]) {
  if (!bridge.codex?.prepareNative) throw new Error('Atualize o Wharnex Desktop para usar Codex Native.')
  return bridge.codex.prepareNative({ projectPath: session.project_path, cacheKey: chat.id, sessionId: session.id,
    requestId: `req_native_${crypto.randomUUID().replaceAll('-', '')}`, text, chatTitle: chat.title,
    model: chat.codexModel, effort: chat.codexEffort, ...(chat.codexPermission ? { permissionLevel: chat.codexPermission } : {}), attachments, projectFiles })
}
