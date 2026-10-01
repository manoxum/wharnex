import type { ChatArtifactKind, ChatArtifactSelection, Session } from '../../types'
import { activePendingRequestId } from '../../lib/agent/runtime/pendingRequest'

export function selectedArtifactKinds(selection: ChatArtifactSelection): ChatArtifactKind[] {
  return (['context', 'prompt', 'result', 'error'] as ChatArtifactKind[]).filter((kind) => selection[kind])
}

export function continuationArtifactSelection(session: Session): ChatArtifactSelection {
  const failure = session.state === 'repair_pending' || session.last_execution?.success === false || Boolean(session.last_repair_error)
  return { context: true, prompt: true, result: Boolean(session.last_execution), error: failure }
}

export function contextArtifact(session: Session) {
  const manifest = session.context.manifest
  const files = manifest.files.slice(0, 240).map((file) => `- ${file.path} · ${file.size} B · ${file.sha256.slice(0, 12)}`).join('\n')
  const omitted = manifest.files.length > 240 ? `\n- ... ${manifest.files.length - 240} ficheiro(s) adicionais` : ''
  return `# Wharnex context snapshot\n\n- id: ${manifest.id}\n- project: ${manifest.project_root}\n- sha256: ${manifest.sha256}\n- files: ${manifest.files.length}\n- text truncated: ${manifest.text_truncated}\n\n## Included files\n\n${files}${omitted}\n`
}

export function sessionContextSHA(session: Session) {
  return session.context.workspace_sha256 || session.context.manifest.sha256
}

export function pendingBundleRequestIDs(session: Session) {
  const requestId = activePendingRequestId(session)
  return requestId ? [requestId] : []
}
