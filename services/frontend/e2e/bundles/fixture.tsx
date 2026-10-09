import { createRoot } from 'react-dom/client'
import { WorkbenchStatusBar } from '../../src/components/workspace/shell/WorkbenchStatusBar'
import '../../src/styles/index.css'

createRoot(document.getElementById('root')!).render(<div className="flex h-screen flex-col bg-(--theme-surface) text-(--theme-text)">
  <main className="flex-1 p-6"><h1>Workspace</h1><button type="button">Ação do workspace</button></main>
  <WorkbenchStatusBar mode="agent" executionMode="protected" automationMode="manual" terminalOpen={false} activeExecutions={0}/>
</div>)
