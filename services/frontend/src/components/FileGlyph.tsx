import { Icon } from './Icon'

type FileGlyphKind = 'file' | 'env' | 'docker' | 'package' | 'json' | 'typescript' | 'javascript' | 'style' | 'markup' | 'markdown' | 'config' | 'shell' | 'php' | 'go' | 'python' | 'database'

export function FileGlyph({ path, size = 12 }: { path: string; size?: number }) {
  const kind = fileGlyphKind(path)
  const icon: 'file' | 'package' | 'database' | 'settings' | 'terminal' | 'code' =
    kind === 'package' || kind === 'docker' ? 'package'
      : kind === 'database' ? 'database'
        : kind === 'env' || kind === 'config' ? 'settings'
          : kind === 'shell' ? 'terminal'
            : isCodeKind(kind) ? 'code'
              : 'file'
  return <span className={`file-glyph file-glyph-${kind}`} aria-hidden="true"><Icon name={icon} size={size}/></span>
}

function fileGlyphKind(path: string): FileGlyphKind {
  const name = path.split('/').pop()?.toLowerCase() || path.toLowerCase()
  if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) return 'env'
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'docker'
  if (name === 'package.json' || name === 'package-lock.json' || name === 'pnpm-lock.yaml' || name === 'yarn.lock' || name === 'bun.lock' || name === 'bun.lockb') return 'package'
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  switch (extension) {
    case 'json': return 'json'
    case 'ts': case 'tsx': return 'typescript'
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'javascript'
    case 'css': case 'scss': case 'sass': case 'less': return 'style'
    case 'html': case 'htm': case 'xml': case 'svg': return 'markup'
    case 'md': case 'mdx': return 'markdown'
    case 'yaml': case 'yml': case 'toml': case 'ini': case 'conf': case 'config': return 'config'
    case 'sh': case 'bash': case 'zsh': return 'shell'
    case 'php': return 'php'
    case 'go': return 'go'
    case 'py': case 'pyw': return 'python'
    case 'sql': case 'db': case 'sqlite': case 'sqlite3': return 'database'
    default: return 'file'
  }
}

function isCodeKind(kind: FileGlyphKind) {
  return kind === 'typescript' || kind === 'javascript' || kind === 'style' || kind === 'markup' || kind === 'php' || kind === 'go' || kind === 'python'
}
