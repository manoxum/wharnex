import type { DockerContainer } from '../../../../types'
import { Icon } from '../../../presentation/chrome/Icon'
import { DockerCondition, DockerStateDot } from './DockerCondition'
import { dockerCondition, dockerStateTone } from './dockerState'

export function DockerContainerRow({ container, active, onSelect }: { container: DockerContainer; active: boolean; onSelect: () => void }) {
  const condition = dockerCondition(container)
  return <button type="button" className={`docker-container-row flex min-h-10 w-full min-w-0 items-center gap-2 border-0 py-1.5 pl-7 pr-2 text-left transition-colors motion-reduce:transition-none ${active ? 'bg-whx-selection text-whx-text' : 'bg-transparent text-whx-soft hover:bg-whx-hover hover:text-whx-text'}`}
    onClick={onSelect} aria-pressed={active} aria-label={`Ver detalhes do container ${container.name || container.id}`}>
    <DockerStateDot tone={dockerStateTone(condition)}/>
    <span className="grid min-w-0 flex-1 gap-0.5"><strong className="truncate text-whx-label font-medium">{container.name || container.id}</strong><small className="truncate font-mono text-whx-caption text-whx-faint">{container.compose_service ? `${container.compose_service} · ` : ''}{container.image}</small></span>
    <DockerCondition state={condition}/>
    {container.protected && <span className="shrink-0 text-whx-faint" title="Backend Wharnex" aria-label="Backend Wharnex"><Icon name="shield" size={12}/></span>}
  </button>
}
