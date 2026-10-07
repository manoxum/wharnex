import { createRoot } from 'react-dom/client'
import '../../src/styles/index.css'
import { WorkspaceShell } from '../../src/components/workspace/shell/WorkspaceShell'
import { api } from '../../src/lib/transport/http/api'
import { saveBoundActiveProject, saveBoundProjects } from '../../src/lib/project/context/projectBindings'

api.config = async () => ({ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: false, chatgpt_web_embed: true })
saveBoundProjects(['/workspace/alpha'])
saveBoundActiveProject('/workspace/alpha')
createRoot(document.getElementById('root')!).render(<WorkspaceShell/>)
