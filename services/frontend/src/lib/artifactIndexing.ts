export type ArtifactIndexKind = 'chat' | 'lib'
export type ArtifactIndexRequest = { kind: ArtifactIndexKind; value: string }

export const ARTIFACT_INDEX_EVENT = 'wharnex:artifact-index'

export function requestArtifactIndex(kind: ArtifactIndexKind, value: string) {
  window.dispatchEvent(new CustomEvent<ArtifactIndexRequest>(ARTIFACT_INDEX_EVENT, { detail: { kind, value } }))
}

export function artifactIndexMarker(kind: ArtifactIndexKind, value: string) {
  return `@{[${kind}]${value}}`
}
