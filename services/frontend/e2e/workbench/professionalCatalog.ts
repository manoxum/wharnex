import { api } from '../../src/lib/transport/http/api'
import { uiTestingApi } from '../../src/lib/ui-testing/uiTestingApi'
import type { UITestingDocument, EvolutionEvidence } from '../../src/types'
import { session, projectPath } from './catalog'

export function installProfessionalData() {
  session.self_evolution = true
  const doc: UITestingDocument = {
    project_id: projectPath, sync_status: 'ready', auto_run_changes: false, guides: [],
    environments: [{ id: 'web', name: 'Atlas Web', url: 'http://localhost:8080', profiles: [] }],
    tests: [
      { id: 'editor', title: 'Abrir um documento no editor', description: 'O documento mantém o conteúdo e a seleção.', goal: 'Abrir src/app.ts', environment_id: 'web', access: 'public', status: 'passed', last_run_id: 'run-editor', steps: [{ action: 'Abrir src/app.ts', expected: 'Código visível' }] },
      { id: 'search', title: 'Pesquisar ficheiros e ações', description: 'A pesquisa deve apresentar resultados com nomes completos.', goal: 'Localizar README.md', environment_id: 'web', access: 'public', status: 'failed', last_run_id: 'run-search' },
      { id: 'tabs', title: 'Restaurar os separadores', goal: 'Preservar a ordem depois de recarregar', environment_id: 'web', access: 'public', status: 'running' },
      { id: 'compact', title: 'Verificar janela compacta', goal: 'Manter o código legível', environment_id: 'web', access: 'public', status: 'queued' },
      { id: 'skip', title: 'Cenário externo opcional', goal: 'Não há credenciais nesta fixture', environment_id: 'web', access: 'public', status: 'skipped' },
    ],
    runs: [
      { id: 'run-editor', test_id: 'editor', status: 'passed', started_at: '2026-10-16T10:00:00Z', completed_at: '2026-10-16T10:00:01.250Z' },
      { id: 'run-search', test_id: 'search', status: 'failed', error: 'O resultado esperado não ficou visível.', started_at: '2026-10-16T10:00:02Z', completed_at: '2026-10-16T10:00:02.580Z' },
    ],
  }
  const evidence: EvolutionEvidence = {
    events: [
      { id: 'event-check', session_id: session.id, category: 'verification', type: 'verification.started', timestamp: '2026-10-16T10:00:00Z', project_path: projectPath, project_name: 'Atlas', data: { target: 'npm run typecheck' } },
      { id: 'event-done', session_id: session.id, category: 'execution', type: 'execution.completed', timestamp: '2026-10-16T10:01:00Z', project_path: projectPath, project_name: 'Atlas', data: { target: 'Verificação concluída' } },
      { id: 'event-error', session_id: session.id, category: 'execution', type: 'execution.failed', timestamp: '2026-10-16T10:02:00Z', project_path: projectPath, project_name: 'Atlas', data: { error: 'A verificação detetou um erro de tipos.' } },
    ], total: 3, truncated: false, counts: { execution: 2, verification: 1 }, projects: [projectPath], categories: ['execution', 'verification'], knowledge: [], knowledge_counts: {}, knowledge_categories: [], knowledge_total: 0, knowledge_truncated: false,
  }
  Object.assign(uiTestingApi, { get: async () => doc })
  Object.assign(api, { evolutionEvidence: async () => evidence })
}
