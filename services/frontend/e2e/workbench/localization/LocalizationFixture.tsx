import { useState } from 'react'
import type { ProjectTodo } from '../../../src/types'
import { api } from '../../../src/lib/transport/http/api'
import { session } from '../catalog'
import { ProjectTodoPanel } from '../../../src/components/project/tasks/ProjectTodoPanel'
import { ComposerRequestControls } from '../../../src/components/chat/composer/ComposerRequestControls'
import { LanguageSettingsPanel } from '../../../src/components/project/settings/LanguageSettingsPanel'

const task: ProjectTodo = {
  id: 'task', project_path: session.project_path, body: 'Guardar alterações', status: 'open',
  kind: 'improvement', urgency: 'urgent', classification_status: 'classified',
  created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:00:00Z',
}
let todos = [task]
Object.assign(api, {
  projectTodos: async () => ({ todos }),
  deleteProjectTodo: async () => { todos = [] },
})
const noop = () => {}
export function LocalizationFixture() {
  const [automation, setAutomation] = useState<'manual' | 'auto' | 'auto_approve'>('manual')
  return <main className="grid min-h-screen grid-cols-2 items-start gap-4 bg-whx-bg p-4 text-whx-body text-whx-text">
    <section className="h-[650px] min-w-0 overflow-hidden rounded-lg border border-whx-border"><ProjectTodoPanel session={session} chatProps={{} as never} onClose={noop} onError={noop}/></section>
    <section className="grid min-w-0 gap-4">
      <div data-testid="composer" className="flex flex-wrap items-center gap-2"><ComposerRequestControls automationMode={automation} effortLevel="high" reasoningEffort="high" contextMode="partial" chatTransportMode="scraper" onAutomationMode={setAutomation} onEffortLevel={noop} onReasoningEffort={noop} onContextMode={noop} onChatTransportMode={noop}/></div>
      <LanguageSettingsPanel onError={noop}/>
    </section>
  </main>
}
