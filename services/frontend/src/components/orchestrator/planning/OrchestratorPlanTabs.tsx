import { WorkbenchTabs } from '../../presentation/tabs'
export type DetailTab = 'summary' | 'files' | 'plan' | 'tasks' | 'executions' | 'engine'

const tabs: Array<{ id: DetailTab; label: string; icon: 'info' | 'folder' | 'plan' | 'list' | 'activity' | 'monitor' }> = [
  { id: 'summary', label: 'Resumo', icon: 'info' },
  { id: 'files', label: 'Ficheiros', icon: 'folder' },
  { id: 'plan', label: 'Plano', icon: 'plan' },
  { id: 'tasks', label: 'Tasks', icon: 'list' },
  { id: 'executions', label: 'Execuções', icon: 'activity' },
  { id: 'engine', label: 'Engine', icon: 'monitor' },
]

export function OrchestratorPlanTabs({ value, onChange }: { value: DetailTab; onChange: (tab: DetailTab) => void }) {
  return <WorkbenchTabs className="sticky -top-3 z-[2] -mx-3 mt-1 sm:-top-4 sm:-mx-4" label="Detalhe do planeamento" value={value} onChange={onChange} items={tabs}/>
}
