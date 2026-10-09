import { WorkbenchTabs } from '../../presentation/tabs'
type RuntimeTab = 'agents' | 'runtime' | 'policies'
export function AgentRuntimeTabs({ value, onChange, agents, running, autoScale }: { value: RuntimeTab; onChange: (value: RuntimeTab) => void; agents: number; running: boolean; autoScale: boolean }) {
  return <WorkbenchTabs label="Áreas do painel de agentes" value={value} onChange={onChange} items={[
    { id: 'agents', label: 'Agentes', icon: 'agent', badge: agents },
    { id: 'runtime', label: 'Runtime', icon: 'monitor', badge: running ? 'online' : 'atenção' },
    { id: 'policies', label: 'Políticas', icon: 'settings', badge: autoScale ? 'auto' : 'manual' },
  ]}/>
}
