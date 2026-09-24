import { request } from './api'

export function rememberOpenedProject(projectPath: string): Promise<void> {
  return request<void>('/api/projects/history', {
    method: 'POST',
    body: JSON.stringify({ project_path: projectPath }),
  })
}

// Best-effort migration for Desktop project paths that predate the durable
// backend history. A missing/stale path must never block workspace startup.
export async function syncOpenedProjectHistory(projectPaths: string[]): Promise<void> {
  const unique = [...new Set(projectPaths.map((path) => path.trim()).filter(Boolean))]
  await Promise.all(unique.map((path) => rememberOpenedProject(path).catch(() => undefined)))
}
