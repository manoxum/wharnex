import { api } from '../../src/lib/transport/http/api'
import { emptyOrchestratorTaskCounts } from '../../src/lib/orchestrator/coordination/orchestratorApi'
import type { DockerOverview, ExecutionErrorRecord } from '../../src/types'
import { projectPath, session } from './catalog'

export function installPolishData(params: URLSearchParams) {
  if (params.get('context-loading') === '1') {
    const original = api.projectConfig
    Object.assign(api, { projectConfig: async (...args: Parameters<typeof api.projectConfig>) => {
      await new Promise((resolve) => window.setTimeout(resolve, 2500))
      return original(...args)
    } })
  }
  const errors: ExecutionErrorRecord[] = params.get('issues') === '1' ? [{
    id: 'fixture-error', session_id: session.id, chat_id: 'chat-fixture', stage: 'verification',
    error: 'A verificação de tipos encontrou um argumento incompatível.', cause: 'O parâmetro name requer uma string.',
    failure_kind: 'typecheck', status: 'open', logs: [{ kind: 'command', argv: ['npm', 'run', 'typecheck'], exit_code: 1, stderr: 'src/app.ts: argumento incompatível' }],
    occurred_at: '2026-10-15T10:00:00Z', updated_at: '2026-10-15T10:00:00Z',
  }] : []
  const docker: DockerOverview = {
    compose_projects: [{ name: 'atlas', container_count: 2, running_count: 1, error_count: 0, stopped_count: 1, services: [] }],
    containers: [
      { id: 'api-local', name: 'atlas-api', image: 'atlas/api:dev', state: 'running', condition: 'running', status: 'Up 2 hours (healthy)', compose_project: 'atlas', compose_service: 'api', ports: '127.0.0.1:8080 → 8080/tcp', networks: 'atlas_default' },
      { id: 'worker-local', name: 'atlas-worker', image: 'atlas/worker:dev', state: 'exited', condition: 'stopped', status: 'Exited (0)', compose_project: 'atlas', compose_service: 'worker' },
    ], images: [], volumes: [], networks: [], refreshed_at: '2026-10-15T10:00:00Z',
  }
  Object.assign(api, {
    executionErrors: async () => ({ errors }), dockerOverview: async () => docker,
    orchestratorOverview: async () => ({ plans: [], tasks: [], task_counts: emptyOrchestratorTaskCounts(), planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 }),
    chatAgentTasks: async () => ({ tasks: [] }),
  })
  if (params.get('changes') === '1') {
    const original = api.gitOverview
    Object.assign(api, { gitOverview: async () => ({ ...await original(session.id), project_path: projectPath, working: {
      clean: false, stageable_count: 2, files: [
        { path: 'src/app.ts', status: 'modified', kind: 'change', additions: 5, deletions: 2 },
        { path: 'README.md', status: 'modified', kind: 'change', additions: 3, deletions: 1 },
      ],
    } }) })
  }
}
