import type { ChatArtifactKind, ChatItem, ChatIterationRef, Session } from '../../types'

export function iterationRef(requestId: string, phase: ChatIterationRef['phase'], artifacts: ChatArtifactKind[], chatgptUrl?: string): ChatIterationRef {
  return { id: crypto.randomUUID(), requestId, phase, artifacts: [...new Set(artifacts)], chatgptUrl }
}

export function turnMeta(kind: NonNullable<Session['last_turn']>['kind']) {
  switch (kind) {
    case 'answer': return 'Resposta · sem alterações'
    case 'clarification': return 'Aguardando esclarecimento'
    case 'investigation': return 'Análise · sem alterações'
    case 'plan': return 'Plano proposto · aguarda aprovação'
    case 'workflow': return 'Workflow local · sandbox Protected'
    case 'blocked': return 'Pedido bloqueado'
    default: return 'Plano de mudança'
  }
}

export function welcomeItem(session: Session): ChatItem {
  return { id: 'welcome', role: 'harness', source: 'wharness', presentation: 'notice', text: session.self_evolution ? 'Auto-evolução detetada: este workspace é o próprio root da instância Wharnex. Mudanças permanecem Protected e, após Apply + build do host, o Wharnex pede confirmação antes de reiniciar; o rollback continua disponível até a nova versão ficar saudável.' : 'Contexto preparado. Pode perguntar, pedir uma análise, explorar uma ideia, diagnosticar o projecto ou solicitar uma alteração.', createdAt: new Date().toISOString(), meta: session.self_evolution ? `AUTO-EVOLUÇÃO · ${session.context.manifest.files.length} ficheiros elegíveis` : `${session.context.manifest.files.length} ficheiros elegíveis no snapshot` }
}

export function truncateRepairCause(cause?: string, limit = 800) {
  const text = (cause || '').trim()
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export function chatGPTProjectName(projectPath: string) {
  const leaf = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || 'Wharnex'
  return /^wharness$/i.test(leaf) ? 'Wharnex' : leaf.slice(0, 80)
}
