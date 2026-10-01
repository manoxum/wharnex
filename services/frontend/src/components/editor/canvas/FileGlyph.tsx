import { directoryGlyphKind, fileGlyphKind, fileGlyphMark, type DirectoryGlyphKind, type FileGlyphKind } from '../../../lib/workspace/layout/workspaceGlyph'
import { Icon } from '../../presentation/chrome/Icon'

export function FileGlyph({ path, size = 12 }: { path: string; size?: number }) {
  const kind = fileGlyphKind(path)
  const mark = fileGlyphMark(path, kind)
  if (mark) return <span className={`file-glyph file-glyph-${kind} file-glyph-mark`} style={{ ['--file-glyph-size' as string]: `${size}px` }} aria-hidden="true">{mark}</span>
  const icon: 'file' | 'package' | 'database' | 'settings' | 'terminal' | 'code' =
    kind === 'package' || kind === 'docker' ? 'package'
      : kind === 'database' ? 'database'
        : kind === 'env' || kind === 'config' ? 'settings'
          : kind === 'shell' ? 'terminal'
            : isCodeKind(kind) ? 'code'
              : 'file'
  return <span className={`file-glyph file-glyph-${kind}`} aria-hidden="true"><Icon name={icon} size={size}/></span>
}

export function DirectoryGlyph({ path, size = 13 }: { path: string; size?: number }) {
  const kind = directoryGlyphKind(path)
  const icon: 'folder' | 'code' | 'package' | 'terminal' | 'database' | 'settings' | 'knowledge' | 'archive' | 'server' | 'image' | 'flask' | 'build' | 'container' | 'schema' = directoryIcon(kind)
  return <span className={`file-glyph directory-glyph directory-glyph-${kind}`} aria-hidden="true"><Icon name={icon} size={size}/></span>
}

function isCodeKind(kind: FileGlyphKind) {
  return kind === 'typescript' || kind === 'javascript' || kind === 'style' || kind === 'markup' || kind === 'php' || kind === 'go' || kind === 'python'
}

function directoryIcon(kind: DirectoryGlyphKind): 'folder' | 'code' | 'package' | 'terminal' | 'database' | 'settings' | 'knowledge' | 'archive' | 'server' | 'image' | 'flask' | 'build' | 'container' | 'schema' {
  switch (kind) {
    case 'source': case 'frontend': return 'code'
    case 'backend': return 'server'
    case 'build': return 'build'
    case 'docker': return 'container'
    case 'scripts': return 'terminal'
    case 'database': return 'database'
    case 'schema': return 'schema'
    case 'config': return 'settings'
    case 'docs': return 'knowledge'
    case 'tests': return 'flask'
    case 'assets': return 'image'
    case 'styles': return 'archive'
    default: return 'folder'
  }
}
