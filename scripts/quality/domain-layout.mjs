import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
// Changes already on the long-lived feature branch predate ADR-0085.
const ADOPTION_COMMIT = '33f1c354e3b69730b58cf0e298b42ccfda3a727d'
const SOURCE = /\.(?:go|ts|tsx|js|jsx|mjs|cjs|css|scss|html|sh|py)$/
const GENERIC = new Set(['common', 'helpers', 'misc', 'utils'])
const ROOT_ENTRIES = new Set([
  'services/desktop/main.mjs', 'services/desktop/dev.mjs',
  'services/desktop/preload.cjs', 'services/desktop/launcher-splash.mjs',
  'services/frontend/src/main.tsx', 'services/webapp/src/main.tsx',
])

export function domainLayoutViolation(file) {
  const parts = file.split('/')
  if (!SOURCE.test(file) || ROOT_ENTRIES.has(file)) return ''
  if (parts[0] === 'services' && parts[1] === 'desktop') {
    if (parts.length < 4 || GENERIC.has(parts[2])) return 'Desktop source must be under a named domain'
  }
  if (parts[0] === 'services' && parts[1] === 'backend' && file.endsWith('.go')) {
    if (parts.length < 5 || !['internal', 'cmd'].includes(parts[2]) || GENERIC.has(parts[3])) return 'backend Go source must be under internal/<domain> or cmd/<command>'
  }
  if (parts[0] === 'services' && ['frontend', 'webapp'].includes(parts[1]) && parts[2] === 'src') {
    if (parts.length < 5 || GENERIC.has(parts[3])) return 'UI source must be under a named domain'
    if (['components', 'hooks', 'lib'].includes(parts[3]) && parts.length < 6) return 'UI feature source needs a domain inside its technical container'
  }
  if (parts[0] === 'scripts' && parts.length < 3) return 'new scripts must be under a named domain'
  if (parts[0] === 'scripts' && GENERIC.has(parts[1])) return 'new scripts need an owning domain'
  return ''
}

function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT }) }
  catch { return Buffer.alloc(0) }
}

function paths(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean)
}

export function newImplementationPaths() {
  const requestedBase = process.env.WHARNEX_DOMAIN_LAYOUT_BASE || ADOPTION_COMMIT
  const base = git(['merge-base', 'HEAD', requestedBase]).toString('utf8').trim() || 'HEAD'
  return [...new Set([
    ...paths(git(['diff', '--name-only', '--diff-filter=A', '-z', `${base}...HEAD`, '--'])),
    ...paths(git(['diff', '--cached', '--name-only', '--diff-filter=A', '-z', '--'])),
    ...paths(git(['ls-files', '--others', '--exclude-standard', '-z'])),
  ])].sort()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = newImplementationPaths()
    .map((file) => ({ file, reason: domainLayoutViolation(file) }))
    .filter(({ reason }) => reason)
  for (const { file, reason } of violations) console.error(`${file}: ${reason}`)
  if (violations.length) process.exitCode = 1
  else console.log('New implementation files have domain owners')
}
