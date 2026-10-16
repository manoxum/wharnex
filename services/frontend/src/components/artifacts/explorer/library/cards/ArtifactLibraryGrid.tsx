import type { ManagedArtifact } from '../../../../../types'
import { ArtifactLibraryCard } from './ArtifactLibraryCard'
import { ARTIFACT_LIBRARY_GRID_CLASS } from './libraryCardStyles'

export function ArtifactLibraryGrid({ items, canIndex, isSelected, onToggleSelected, onOpen, onIndex, onDelete }: {
  items: ManagedArtifact[]
  canIndex: boolean
  isSelected: (item: ManagedArtifact) => boolean
  onToggleSelected: (item: ManagedArtifact) => void
  onOpen: (item: ManagedArtifact) => void
  onIndex: (item: ManagedArtifact) => void
  onDelete: (item: ManagedArtifact) => void
}) {
  return <div className={ARTIFACT_LIBRARY_GRID_CLASS}>{items.map((item) => <ArtifactLibraryCard
    key={`${item.session_id}:${item.artifact.id}`}
    item={item}
    canIndex={canIndex}
    selected={isSelected(item)}
    onToggleSelected={() => onToggleSelected(item)}
    onOpen={() => onOpen(item)}
    onIndex={() => onIndex(item)}
    onDelete={() => onDelete(item)}
  />)}</div>
}
