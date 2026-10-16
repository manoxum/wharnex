import type { FileEntry, GitOverview, Session } from '../../src/types'
import { api } from '../../src/lib/transport/http/api'

export const projectPath = '/workspace/atlas'
export const session: Session = { id: 'workbench-fixture', project_path: projectPath, state: 'ready', execution_mode: 'protected', automation_mode: 'manual', context_mode: 'full', reasoning_effort: 'high', created_at: '2026-10-15T10:00:00Z', context: { id: 'context-fixture', manifest: { id: 'context-fixture', project_root: projectPath, sha256: 'fixture', files: [], excluded: [], text_truncated: false } } }
const code = 'export function greet(name: string): string {\n  return `Olá, ${name}`\n}\n\nexport const project = "Atlas"\n'
const files: FileEntry[] = [
  { name: 'src', path: 'src', kind: 'directory', size: 0 },
  { name: 'app.ts', path: 'src/app.ts', kind: 'file', size: code.length },
  { name: 'README.md', path: 'README.md', kind: 'file', size: 100 },
  { name: 'package.json', path: 'package.json', kind: 'file', size: 40 },
]
const overview = { project_path: projectPath, repository: '', repositories: [], project_version: 'v1.0.0', available: true, commit_mode: 'manual', current_branch: 'feature/workbench', detached: false, has_identity: true, branches: [{ name: 'feature/workbench', current: true, commit_sha: 'fixture', ahead: 0, behind: 0, has_upstream: false, gone: false }], remotes: [], commits: [], pending: [], working: { clean: true, stageable_count: 0, files: [] } } as GitOverview
export function installWorkbenchData() {
  Object.assign(api, {
    listFiles: async () => ({ files }), gitOverview: async () => overview,
    readFile: async (...[, path]: [string, string]) => ({ path, content: path.endsWith('.md') ? '# Atlas\n\nUm workspace de demonstração local.' : code, sha256: 'fixture-sha', size: code.length }),
    projectConfig: async () => ({ version: 1, project: { name: 'atlas' }, context: { auto_exclude: true, max_file_bytes: 2097152, include: [], exclude: [] } }),
    contextInspection: async () => ({ snapshot_id: 'fixture', sha256: 'fixture', project_root: projectPath, included_files: 3, excluded_items: 0, included_bytes: 200, roots: [], entries: [], rules: [] }),
    storage: async () => ({ total_bytes: 0, projects: [] }), artifactSettings: async () => ({ retention_days: 30, bundle_window_limit: 80 }),
    projectTasks: async () => ({ tasks: [], next_cursor: '', has_more: false }), executionConcurrency: async () => ({ concurrency: 2, max: 4 }),
    bundleQuota: async () => ({ sent: 0, received: 0, limit: 80 }),
    eventHistory: async () => ({ events: [] }), executionErrors: async () => ({ errors: [] }),
    languageSettings: async () => ({ version: 1, interface_language: 'pt', translation_languages: ['en'] }),
    updateLanguageSettings: async (value: unknown) => value,
    managedArtifacts: async () => ({ artifacts: [] }), browserMonitorChats: async () => ({ chats: [] }),
  })
}
