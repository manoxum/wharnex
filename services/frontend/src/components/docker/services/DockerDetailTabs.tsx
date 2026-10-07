import { WorkbenchTabs } from '../../presentation/tabs'
export function DockerDetailTabs({ value, onChange }: { value: 'overview' | 'logs'; onChange: (tab: 'overview' | 'logs') => void }) {
  return <WorkbenchTabs label="Detalhes do container" value={value} onChange={onChange} items={[
    { id: 'overview', label: 'Overview', icon: 'container' }, { id: 'logs', label: 'Logs', icon: 'list' },
  ]}/>
}
