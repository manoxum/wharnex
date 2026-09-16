export type ArtifactPreviewKind = 'image' | 'audio' | 'video' | 'pdf' | 'html' | 'office' | 'markdown' | 'text' | 'binary'

export type ArtifactCapability = 'zoom' | 'rotate' | 'flip' | 'filters' | 'native-media' | 'raw' | 'preview' | 'wrap' | 'download'

export type ArtifactPreviewDefinition = {
  kind: ArtifactPreviewKind
  capabilities: ArtifactCapability[]
}

export function artifactPreviewDefinition(path: string, declaredKind?: string): ArtifactPreviewDefinition {
  const kind = isKnownKind(declaredKind) ? declaredKind : inferPreviewKind(path)
  return { kind, capabilities: capabilitiesFor(kind) }
}

function capabilitiesFor(kind: ArtifactPreviewKind): ArtifactCapability[] {
  switch (kind) {
    case 'image': return ['zoom', 'rotate', 'flip', 'filters', 'download']
    case 'audio':
    case 'video': return ['native-media', 'download']
    case 'markdown': return ['preview', 'raw', 'wrap', 'download']
    case 'html': return ['preview', 'raw', 'wrap', 'download']
    case 'office': return ['preview', 'raw', 'wrap', 'download']
    case 'pdf': return ['preview', 'download']
    case 'text': return ['raw', 'wrap', 'download']
    default: return ['download']
  }
}

function isKnownKind(value?: string): value is ArtifactPreviewKind {
  return Boolean(value && ['image', 'audio', 'video', 'pdf', 'html', 'office', 'markdown', 'text', 'binary'].includes(value))
}

function inferPreviewKind(path: string): ArtifactPreviewKind {
  const name = path.split('/').pop()?.toLowerCase() || ''
  const extension = name.split('.').pop() || ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(extension)) return 'image'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(extension)) return 'audio'
  if (['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(extension)) return 'video'
  if (extension === 'pdf') return 'pdf'
  if (['html', 'htm'].includes(extension)) return 'html'
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'].includes(extension)) return 'office'
  if (['md', 'mdx', 'markdown'].includes(extension)) return 'markdown'
  if (['dockerfile', 'makefile', 'justfile', 'procfile'].includes(name)) return 'text'
  if (['txt', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'go', 'py', 'pyi', 'sh', 'bash', 'zsh', 'fish', 'css', 'scss', 'sass', 'less', 'sql', 'diff', 'patch', 'log', 'ini', 'env', 'conf', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'rs', 'rb', 'java', 'kt', 'kts', 'cs', 'php', 'swift', 'lua', 'r', 'dart', 'vue', 'svelte', 'graphql', 'gql', 'proto'].includes(extension)) return 'text'
  return 'binary'
}
