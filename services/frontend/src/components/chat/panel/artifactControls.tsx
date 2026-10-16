import { Icon } from '../../presentation/chrome/Icon'
import type { ChatArtifactKind, ChatItem } from '../../../types'
import { iterationPhaseLabel } from './noticePresentation'
import { artifactIcon, artifactLabel } from './presentation/artifactPresentation'
import { Button } from '../../presentation/workbench'

export function ArtifactToggle({ kind, label, selected, required = false, disabled = false, inspectable = false, onToggle, onInspect }: { kind: ChatArtifactKind; label: string; selected: boolean; required?: boolean; disabled?: boolean; inspectable?: boolean; onToggle?: (kind: ChatArtifactKind) => void; onInspect?: (kind: ChatArtifactKind) => void }) {
  const title = `${required ? `${label} · selecionado automaticamente` : `${label} · ${selected ? 'será anexado' : 'não será anexado'}`}${inspectable ? ' · clique duplo para visualizar' : ''}`
  return <Button icon={selected ? 'check' : 'file'} aria-label={label} aria-pressed={selected} disabled={disabled} title={title} className="!justify-start" onDoubleClick={() => { if (inspectable) onInspect?.(kind) }} onClick={() => { if (!required) onToggle?.(kind); else if (inspectable) onInspect?.(kind) }}>{label}{required ? ' · automático' : selected ? ' · incluído' : ''}</Button>
}

export function IterationReference({ item, onInspectArtifact, artifactContent }: { item: ChatItem; onInspectArtifact: (kind: ChatArtifactKind) => void; artifactContent?: Partial<Record<ChatArtifactKind, string>> }) {
  const iteration = item.iteration!
  return <div className="message-iteration" id={iteration.phase === 'outbound' ? `request-${iteration.requestId}` : undefined} title={iteration.chatgptUrl || iteration.requestId}>
    <Icon name="bridge" size={11}/><a href={`#request-${iteration.requestId}`} aria-label={`Pedido ${iteration.requestId}`}><code>{iteration.requestId.replace(/^req_/, '').slice(0, 18)}</code></a><span>{iterationPhaseLabel(iteration.phase)}</span>
    <span className="iteration-artifacts">{iteration.artifacts.map((kind) => <button type="button" key={kind} title={`Ver ${artifactLabel(kind)}`} aria-label={`Ver ${artifactLabel(kind)}`} disabled={!artifactContent?.[kind]} onClick={() => onInspectArtifact(kind)}>{artifactIcon(kind)}</button>)}</span>
  </div>
}
