import type { TaskPolicy, TaskPolicyState } from '../../../../lib/agent/automationHolds'

export type TaskCategory = { id: string; label: string; description: string; types: readonly (readonly [type: string, label: string])[] }

// Presentation only: which task types exist, and their pool, comes from the
// backend catalog. A type the backend reports that no category names still
// shows under "Outros", so no browser task can escape policy control.
export const taskCategories: readonly TaskCategory[] = [
  { id: 'conversation', label: 'Conversa', description: 'Pedidos dos chats: envio, recuperação e acompanhamento da resposta.', types: [
    ['BOT_WRITE', 'Enviar pedido'], ['RECOVERY_WRITE', 'Recuperar ou continuar pedido'], ['AWAIT_RESPONSE', 'Acompanhar resposta'],
  ] },
  { id: 'orchestration', label: 'Orquestração', description: 'Planeamento e execução das tarefas do Orchestrator.', types: [
    ['ORCHESTRATOR_PLAN', 'Planear tarefa'], ['ORCHESTRATOR_EXECUTE', 'Executar tarefa'],
  ] },
  { id: 'ui-testing', label: 'Testes UI', description: 'Descoberta e execução dos testes do UI Lab.', types: [
    ['UI_TEST_DISCOVER', 'Descobrir testes UI'], ['UI_TEST_RUN', 'Executar teste UI'],
  ] },
  { id: 'utility', label: 'Utilitários', description: 'Trabalho por artefacto: tradução, release notes e TODOs.', types: [
    ['TRANSLATE_MARKDOWN', 'Traduzir Markdown'], ['RELEASE_NOTES', 'Gerar release notes'], ['TODO_CLASSIFY', 'Classificar TODO'],
  ] },
  { id: 'maintenance', label: 'Manutenção de chats', description: 'Organização, arquivo e limpeza de conversas e bundles.', types: [
    ['ORGANIZE_CHAT', 'Organizar chat'], ['RENAME_CHAT', 'Renomear chat'], ['ARCHIVE_CHAT', 'Arquivar chat'],
    ['DELETE_CHAT', 'Eliminar chat'], ['DELETE_TEMP_CHAT', 'Eliminar chat temporário'], ['DELETE_BUNDLE', 'Eliminar bundle'],
  ] },
  { id: 'titles', label: 'Títulos', description: 'Descoberta e geração de títulos de conversa.', types: [
    ['TITLE_DISCOVER', 'Descobrir título'], ['TITLE_GENERATE_TEMP', 'Gerar título temporário'], ['TITLE_AWAIT', 'Aguardar título'],
  ] },
]

export type CategoryView = { category: TaskCategory; items: { policy: TaskPolicy; label: string }[] }

export function groupTaskPolicies(policies: readonly TaskPolicy[]): CategoryView[] {
  const byType = new Map(policies.map((policy) => [policy.type, policy]))
  const named = new Set<string>()
  const views: CategoryView[] = taskCategories.map((category) => ({
    category,
    items: category.types.flatMap(([type, label]) => {
      named.add(type)
      const policy = byType.get(type)
      return policy ? [{ policy, label }] : []
    }),
  }))
  const others = policies.filter((policy) => !named.has(policy.type)).map((policy) => ({ policy, label: policy.type }))
  if (others.length) views.push({ category: { id: 'others', label: 'Outros', description: 'Tipos novos ainda sem categoria.', types: [] }, items: others })
  return views.filter((view) => view.items.length > 0)
}

export const stateLabels: Record<TaskPolicyState, string> = { active: 'Ativo', suspended: 'Suspenso', cooldown: 'Cooldown' }

export const poolLabels: Record<TaskPolicy['pool'], string> = { supervisor: 'Supervisor', worker: 'Worker', ephemeral: 'Worker efémero' }

const cooldownLabels = { rate_limit: 'Rate limit', upload_limit: 'Limite de upload' } as const

function clock(value?: string) {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? new Date(time).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : ''
}

// One short line saying why a type is not active and when that changes;
// an active type needs none.
export function stateDetail(policy: TaskPolicy) {
  if (policy.state === 'suspended') {
    const origin = policy.hold.default ? 'Por omissão' : 'Manual'
    const until = clock(policy.hold.until)
    return `${origin} · ${until ? `retoma às ${until}` : 'até retomar'}`
  }
  if (policy.state === 'cooldown') {
    return policy.cooldowns.map((cooldown) => {
      const until = clock(cooldown.until)
      return `${cooldownLabels[cooldown.kind]}${until ? ` · até ${until}` : ''}`
    }).join(' · ')
  }
  return ''
}
