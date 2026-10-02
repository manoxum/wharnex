import { useEffect } from 'react'
import type { Session } from '../../../types'
import type { Drawer } from '../../../lib/workspace/layout/workspaceDrawer'
import type { WorkspaceTool } from '../../../lib/workspace/layout/workspaceRailLayout'
import { uiTestingApi } from '../../../lib/ui-testing/uiTestingApi'

export function useUITestingContextSync(session: Session, drawer: Drawer, tools: WorkspaceTool[], pinnedTools: WorkspaceTool[]) {
  useEffect(() => {
    if (!tools.includes('ui-testing') && !pinnedTools.includes('ui-testing') && drawer !== 'ui-testing') return
    let cancelled = false
    void (async () => {
      try {
        const document = await uiTestingApi.get(session.id)
        if (!cancelled && document.sync_status !== 'syncing' && document.context_sha256 !== session.context.manifest.sha256) {
          await uiTestingApi.sync(session.id)
        }
      } catch { /* The operator can still synchronize UI Lab manually. */ }
    })()
    return () => { cancelled = true }
  }, [drawer, pinnedTools, session.context.manifest.sha256, session.id, tools])
}
