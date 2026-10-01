export type FileGlyphKind = 'file' | 'env' | 'docker' | 'package' | 'json' | 'typescript' | 'javascript' | 'style' | 'markup' | 'markdown' | 'config' | 'shell' | 'php' | 'go' | 'python' | 'database'
export type DirectoryGlyphKind = 'folder' | 'source' | 'build' | 'scripts' | 'docker' | 'database' | 'schema' | 'docs' | 'tests' | 'config' | 'assets' | 'styles' | 'backend' | 'frontend'

export const DIRECTORY_ICON_ALIASES: Record<Exclude<DirectoryGlyphKind, 'folder'>, readonly string[]> = {
  source: ['src', 'source', 'sources', 'app', 'apps', 'lib', 'libs', 'library', 'libraries', 'module', 'modules', 'package', 'packages', 'component', 'components'],
  build: ['build', 'builds', 'dist', 'out', 'output', 'outputs', 'target', 'targets', 'release', 'releases', 'bin', 'bundle', 'bundles', 'generated'],
  scripts: ['script', 'scripts', 'cli', 'command', 'commands', 'tool', 'tools', 'tooling', 'task', 'tasks', 'job', 'jobs', 'automation', 'automations'],
  docker: ['docker', 'container', 'containers', 'compose', 'kubernetes', 'k8s', 'helm', 'deploy', 'deployment', 'deployments'],
  database: ['db', 'database', 'databases', 'data', 'storage', 'sql', 'postgres', 'postgresql', 'mysql', 'maria', 'mariadb', 'mongo', 'mongodb', 'redis', 'migration', 'migrations', 'seed', 'seeds'],
  schema: ['schema', 'schemas', 'model', 'models', 'entity', 'entities', 'type', 'types', 'typedef', 'typedefs', 'graphql'],
  docs: ['doc', 'docs', 'documentation', 'guide', 'guides', 'wiki', 'note', 'notes', 'manual', 'manuals'],
  tests: ['test', 'tests', 'testing', 'spec', 'specs', '__tests__', 'fixture', 'fixtures', 'mock', 'mocks', 'e2e', 'integration'],
  config: ['config', 'configs', 'configuration', 'settings', '.config', '.github', '.gitlab', '.idea', '.vscode', 'ci', 'cd'],
  assets: ['asset', 'assets', 'static', 'public', 'image', 'images', 'img', 'icon', 'icons', 'media', 'font', 'fonts', 'resource', 'resources'],
  styles: ['style', 'styles', 'css', 'scss', 'sass', 'less', 'theme', 'themes'],
  backend: ['backend', 'server', 'servers', 'api', 'apis', 'service', 'services', 'worker', 'workers'],
  frontend: ['frontend', 'client', 'clients', 'web', 'ui', 'view', 'views', 'page', 'pages'],
}

const DIRECTORY_ALIAS_LOOKUP = new Map<string, DirectoryGlyphKind>(
  Object.entries(DIRECTORY_ICON_ALIASES).flatMap(([kind, aliases]) => aliases.map((alias) => [alias, kind as DirectoryGlyphKind] as const)),
)

export function directoryGlyphKind(path: string): DirectoryGlyphKind {
  const name = leafName(path)
  return DIRECTORY_ALIAS_LOOKUP.get(name) || 'folder'
}

export function fileGlyphKind(path: string): FileGlyphKind {
  const name = leafName(path)
  if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) return 'env'
  if (name === 'dockerfile' || name.startsWith('dockerfile.') || name === 'compose.yml' || name === 'compose.yaml') return 'docker'
  if (name === 'package.json' || name === 'package-lock.json' || name === 'pnpm-lock.yaml' || name === 'yarn.lock' || name === 'bun.lock' || name === 'bun.lockb') return 'package'
  if (name === 'makefile' || name === 'gnumakefile') return 'shell'
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  switch (extension) {
    case 'json': return 'json'
    case 'ts': case 'tsx': return 'typescript'
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'javascript'
    case 'css': case 'scss': case 'sass': case 'less': return 'style'
    case 'html': case 'htm': case 'xml': case 'svg': return 'markup'
    case 'md': case 'mdx': case 'markdown': return 'markdown'
    case 'yaml': case 'yml': case 'toml': case 'ini': case 'conf': case 'config': return 'config'
    case 'sh': case 'bash': case 'zsh': case 'fish': return 'shell'
    case 'php': return 'php'
    case 'go': return 'go'
    case 'py': case 'pyw': return 'python'
    case 'sql': case 'db': case 'sqlite': case 'sqlite3': return 'database'
    default: return 'file'
  }
}

export function fileGlyphMark(path: string, kind: FileGlyphKind): string | undefined {
  const name = leafName(path)
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  switch (kind) {
    case 'typescript': return extension === 'tsx' ? 'TX' : 'TS'
    case 'javascript': return extension === 'jsx' ? 'JX' : 'JS'
    case 'json': return '{}'
    case 'style': return extension.toUpperCase().slice(0, 2) || 'CSS'
    case 'markup': return extension === 'svg' ? 'SV' : '<>'
    case 'markdown': return 'MD'
    case 'php': return 'P'
    case 'go': return 'GO'
    case 'python': return 'PY'
    default: return undefined
  }
}

function leafName(path: string) {
  return path.split('/').pop()?.toLowerCase() || path.toLowerCase()
}
