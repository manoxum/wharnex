import { supervisorInstanceLabel } from '../lib/engineInstanceLabel'

type Props = {
  supervisorId?: string
  followedAgentId: string
  followedWorker?: DesktopAgentRuntimeAgent
  workers: DesktopAgentRuntimeAgent[]
  onSelect: (agentId: string) => void
}

export function EngineInstanceSelector({ supervisorId, followedAgentId, followedWorker, workers, onSelect }: Props) {
  return <label className="desktop-engine-instance" title="Escolher a instância mostrada no Engine">
    <span>Instância</span>
    <select aria-label="Instância do Engine" value={followedAgentId} onChange={(event) => onSelect(event.target.value)}>
      <option value="">{supervisorInstanceLabel(supervisorId)}</option>
      {followedAgentId && !followedWorker && <option value={followedAgentId}>{followedAgentId.replace('worker-', 'Worker ')}</option>}
      {workers.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
    </select>
  </label>
}
