import { createRoot } from 'react-dom/client'
import '../../src/styles/index.css'
import { saveUIPreferences, loadUIPreferences } from '../../src/lib/workspace/preferences/uiPreferences'
import { installWorkbenchData, projectPath } from './catalog'
import { WorkbenchFixture } from './WorkbenchFixture'
import { ReviewFixture } from './ReviewFixture'
import { installMonitorFixture } from './monitorFixture'
import { BrowserMonitor as MonitorFixture } from '../../src/components/agent/browser-monitor/BrowserMonitor'
import { installFixtureBridge } from '../codex/bridge'
import { loadWorkbenchState, saveWorkbenchState } from '../../src/lib/workspace/preferences/workbenchPreferences'
import { installProfessionalData } from './professionalCatalog'
import { installPolishData } from './polishCatalog'

const params = new URLSearchParams(location.search)
saveUIPreferences({ ...loadUIPreferences(), ...(params.get('density') === 'compact' ? { density: 'compact' as const } : {}), theme: params.get('palette') === 'original' ? 'original' : params.get('theme') === 'light' ? 'jetbrains-light' : 'jetbrains-darcula', scale: Number(params.get('scale')) || 1 })
const previous = loadWorkbenchState(projectPath)
if (!localStorage.getItem(`whx.workbench.layout.v1:${projectPath}`)) saveWorkbenchState(projectPath, { ...previous, left: { ...previous.left, open: true, size: 280, tool: 'project' } })
installFixtureBridge()
Object.assign(window.wharnessDesktop!, { data: { storage: async () => ({ total_bytes: 0, browser_bytes: 0, attachment_bytes: 0, temp_bytes: 0 }) } })
installWorkbenchData()
installPolishData(params)
if (params.get('professional') === '1') installProfessionalData()
if (params.get('surface') === 'monitor') installMonitorFixture()
createRoot(document.getElementById('root')!).render(params.get('surface') === 'monitor' ? <MonitorFixture/> : params.get('surface') === 'diff' ? <ReviewFixture/> : <WorkbenchFixture/>)
