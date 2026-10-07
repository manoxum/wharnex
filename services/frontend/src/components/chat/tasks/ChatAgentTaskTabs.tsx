import { WorkbenchTabs } from '../../presentation/tabs'
import type { IconName } from '../../presentation/chrome/Icon'
export function ChatAgentTaskTabs<Id extends string>({ value, onChange, tabs }: { value: Id; onChange: (id: Id) => void; tabs: ReadonlyArray<{ id: Id; label: string; icon: IconName; count: number }> }) {
  return <WorkbenchTabs label="Estados das tarefas" value={value} onChange={onChange} items={tabs.map((tab) => ({ ...tab, badge: tab.count, controls: 'chat-agent-task-panel' }))}/>
}
