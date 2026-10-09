import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = resolve(import.meta.dirname, '../../..')
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? sources(path) : /\.tsx$/.test(path) && !/\.test\.tsx$/.test(path) ? [path] : []
  })
}

describe('workbench tab adoption gate', () => {
  it('forbids independent ARIA tab implementations outside the shared primitives', () => {
    const offenders = sources(sourceRoot).filter((path) => !path.includes('/presentation/tabs/'))
      .filter((path) => /role=["'](?:tab|tablist)["']/.test(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('uses the shared implementation in every migrated panel and resource surface', () => {
    const owners = [
      'agent/browser-monitor/BrowserMonitorList', 'agent/runtime/AgentRuntimeTabs', 'agent/workspace/AgentSurfaceTabs',
      'project/ui-testing/UITestingPanel', 'project/ui-testing/documentation/UIDocsTab', 'git/review/GitTabs',
      'project/tasks/ProjectTaskTabs', 'project/tasks/ProjectTodoTabs', 'chat/tasks/ChatAgentTaskTabs',
      'database/browser/DatabaseExplorerPanel', 'database/browser/DatabaseObjectBrowser', 'artifacts/explorer/ArtifactLibraryTabs',
      'chat/panel/ChatManagementDrawer', 'chat/attachments/ComposerAttachmentTabs', 'docker/services/DockerDetailTabs',
      'orchestrator/tasks/OrchestratorTaskDetailTabs', 'orchestrator/planning/OrchestratorPlanTabs', 'project/knowledge/EvolutionEvidenceTabs',
      'editor/inspector/InspectorTabs', 'editor/inspector/ContextInspector', 'editor/inspector/ConflictResolverModal',
      'execution/history/ExecutionErrorsDrawer', 'execution/recovery/RestartConfirmation', 'editor/canvas/EditorTabs',
      'terminal/workspace/TerminalTabBar', 'chat/navigation/ChatTabs', 'workspace/surfaces/WorkspaceSurfaceTabs', 'workspace/projects/ProjectTabs',
    ]
    for (const owner of owners) expect(readFileSync(resolve(sourceRoot, `components/${owner}.tsx`), 'utf8'), owner).toContain('/presentation/tabs')
  })

  it('limits restored resource appearances to their explicitly authorized owners', () => {
    const owners = {
      terminal: 'components/terminal/workspace/TerminalTabBar.tsx',
      conversation: 'components/chat/navigation/ChatTabs.tsx',
      project: 'components/workspace/projects/ProjectTabs.tsx',
      document: 'components/editor/canvas/EditorTabs.tsx',
    }
    for (const [appearance, owner] of Object.entries(owners)) {
      const adopters = sources(sourceRoot).filter((path) => !path.includes('/presentation/tabs/'))
        .filter((path) => readFileSync(path, 'utf8').includes(`appearance="${appearance}"`))
      expect(adopters).toEqual([resolve(sourceRoot, owner)])
    }
  })
})
