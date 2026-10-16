import { api } from '../../../../../lib/transport/http/api'
import type { ManagedArtifact } from '../../../../../types'
import { ArtifactPreview } from '../../ArtifactPreview'
import { formatBytes, formatDate, projectName, shortIdentifier, artifactTypeLabel } from '../artifactPresentation'
import { Icon } from '../../../../presentation/chrome/Icon'
import { Button, IconButton } from '../../../../presentation/workbench'
import { ARTIFACT_LIBRARY_BUNDLE_CARD_CLASS, ARTIFACT_LIBRARY_CARD_CLASS, ARTIFACT_LIBRARY_FILE_CARD_CLASS, ARTIFACT_LIBRARY_PREVIEW_CLASS, ARTIFACT_LIBRARY_SELECTED_CARD_CLASS } from './libraryCardStyles'

type Props = {
  item: ManagedArtifact
  canIndex: boolean
  selected: boolean
  onToggleSelected: () => void
  onOpen: () => void
  onIndex: () => void
  onDelete: () => void
}

export function ArtifactLibraryCard({ item, canIndex, selected, onToggleSelected, onOpen, onIndex, onDelete }: Props) {
  const artifact = item.artifact
  const bundle = artifact.bundle
  const directionLabel = bundle ? (artifact.direction === 'input' ? 'Pedido' : 'Resposta') : artifact.direction === 'input' ? 'Recebido' : 'Devolvido'
  const className = [ARTIFACT_LIBRARY_CARD_CLASS, bundle ? ARTIFACT_LIBRARY_BUNDLE_CARD_CLASS : ARTIFACT_LIBRARY_FILE_CARD_CLASS, selected && ARTIFACT_LIBRARY_SELECTED_CARD_CLASS].filter(Boolean).join(' ')

  return <article className={className} data-selected={selected || undefined}>
    <label className="absolute left-2.5 top-2.5 z-10 grid size-7 cursor-pointer place-items-center rounded-md bg-whx-bg/90" title={`Selecionar ${artifact.name}`}>
      <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label={`Selecionar ${artifact.name}`} className="size-4 cursor-pointer accent-[var(--theme-accent)]"/>
    </label>
    <button type="button" className={`${ARTIFACT_LIBRARY_PREVIEW_CLASS} group/preview cursor-pointer`} aria-label={`Abrir ${artifact.name}`} onClick={onOpen}>
      {bundle ? <BundleCardPreview/> : <ArtifactPreview path={artifact.name} size={artifact.size} compact url={api.artifactURL(item.session_id, artifact.id, true)}/>}
      <span className="absolute left-10 top-2 z-[1] inline-flex min-h-6 items-center rounded-md border border-whx-border-soft bg-whx-bg/90 px-2 text-whx-caption font-semibold text-whx-soft">{bundle ? 'BUNDLE' : artifactTypeLabel(artifact.name, artifact.content_type)}</span>
      <span className="absolute right-2 top-2 z-[1] inline-flex min-h-6 items-center rounded-md border border-whx-border-soft bg-whx-bg/90 px-2 text-whx-caption font-semibold text-whx-soft">{directionLabel}</span>
    </button>
    <div className="grid min-w-0 gap-1.5 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-whx-muted text-whx-soft" aria-hidden="true"><Icon name={bundle ? 'package' : 'file'} size={14}/></span>
        <strong className="min-w-0 flex-1 truncate text-[calc(13px*var(--ui-font-scale))] font-semibold leading-snug text-whx-text" title={artifact.name}>{artifact.name}</strong>
      </div>
      <small className="truncate text-[calc(11px*var(--ui-font-scale))] font-medium text-whx-soft" title={item.project_path}>{projectName(item.project_path)}{item.chat_id ? ` · ${shortIdentifier(item.chat_id)}` : ''}</small>
      <span className="truncate text-[calc(11px*var(--ui-font-scale))] text-whx-faint">{formatBytes(artifact.size)} · {formatDate(artifact.created_at)}</span>
    </div>
    <div className="flex min-h-10 items-center justify-between gap-1.5 border-t border-whx-border-soft px-2">
      <div className="flex min-w-0 items-center gap-1">
        {canIndex ? <Button tone="quiet" icon="link" onClick={onIndex} className="!min-h-8 !px-2 !text-[calc(11px*var(--ui-font-scale))]">Indexar</Button> : null}
        <Button tone="neutral" icon="external" onClick={onOpen} className="!min-h-8 !px-2 !text-[calc(11px*var(--ui-font-scale))]">Abrir</Button>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <a href={api.artifactURL(item.session_id, artifact.id)} download={artifact.name} aria-label={`Descarregar ${artifact.name}`} title="Descarregar" className="grid size-8 place-items-center rounded-md text-whx-faint transition-colors hover:bg-whx-hover hover:text-whx-text focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-whx-accent"><Icon name="download" size={15}/></a>
        <IconButton label={`Eliminar ${artifact.name}`} title="Eliminar" icon="trash" tone="danger" onClick={onDelete}/>
      </div>
    </div>
  </article>
}

function BundleCardPreview() {
  return <div className="flex h-full min-h-0 w-full items-center justify-center gap-3 bg-whx-muted/50 px-4 py-3">
    <span className="grid size-14 shrink-0 place-items-center rounded-lg border border-whx-border-soft bg-whx-surface text-whx-soft" aria-hidden="true"><Icon name="package" size={27}/></span>
    <span className="grid min-w-0 gap-1.5 text-left">
      <strong className="truncate text-[calc(13px*var(--ui-font-scale))] font-semibold leading-snug text-whx-text">Pacote ZIP</strong>
    </span>
  </div>
}
