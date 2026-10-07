import { WorkbenchTabs } from '../../presentation/tabs'
import type { InspectorTab } from './Inspector'
export function InspectorTabs({ value, onChange, executions }: { value: InspectorTab; onChange: (tab: InspectorTab) => void; executions: number }) {
  return <WorkbenchTabs label="Inspector" value={value} onChange={onChange} items={[
    { id: 'files', label: 'Ficheiros', icon: 'folder' }, { id: 'plan', label: 'Plano', icon: 'plan' },
    { id: 'terminal', label: 'Execução', icon: 'terminal', badge: executions }, { id: 'chatgpt', label: 'Engine', icon: 'agent' },
    { id: 'direct-chatgpt', label: 'ChatGPT', icon: 'chatgpt' },
  ]}/>
}
