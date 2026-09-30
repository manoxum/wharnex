import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
// Bootstrap while ADR-0085 is uncommitted; after commit, derive its parent.
const BOOTSTRAP_BASE = '33f1c354e3b69730b58cf0e298b42ccfda3a727d'
const ADOPTION_ADR = 'adr/ADR-0085-domain-owned-source-layout.md'
const SOURCE = /\.(?:go|ts|tsx|js|jsx|mjs|cjs|css|scss|html|sh|py)$/
const GENERIC = new Set(['common', 'helpers', 'misc', 'utils'])
const MAX_FILES_PER_DIRECTORY = 20
const ROOT_ENTRIES = new Set([
  'services/desktop/main.mjs', 'services/desktop/preload.cjs',
  'services/frontend/src/main.tsx', 'services/webapp/src/main.tsx',
])

export function domainLayoutViolation(file) {
  const parts = file.split('/')
  if (!SOURCE.test(file) || ROOT_ENTRIES.has(file)) return ''
  if (parts[0] === 'services' && parts[1] === 'desktop') {
    if (parts.length < 4 || parts.slice(2, -1).some((part) => GENERIC.has(part))) return 'Desktop source must be under named domains and subdomains'
  }
  if (parts[0] === 'services' && parts[1] === 'backend' && file.endsWith('.go')) {
    if (parts.length < 5 || !['internal', 'cmd'].includes(parts[2]) || parts.slice(3, -1).some((part) => GENERIC.has(part))) return 'backend Go source must be under internal/<domain> or cmd/<command>'
  }
  if (parts[0] === 'services' && ['frontend', 'webapp'].includes(parts[1]) && parts[2] === 'src') {
    if (parts.length < 5 || parts.slice(3, -1).some((part) => GENERIC.has(part))) return 'UI source must be under named domains and subdomains'
    if (['components', 'hooks', 'lib'].includes(parts[3]) && parts.length < 6) return 'UI feature source needs a domain inside its technical container'
    if (parts[1] === 'frontend' && parts[3] === 'styles' && parts[4] === 'domains' && parts.length < 7) return 'Desktop CSS needs a named surface inside styles/domains'
  }
  if (parts[0] === 'scripts' && parts.length < 3) return 'new scripts must be under a named domain'
  if (parts[0] === 'scripts' && parts.slice(1, -1).some((part) => GENERIC.has(part))) return 'new scripts need an owning domain'
  return ''
}

export function overfullDirectoryViolations(newFiles, allFiles) {
  const presentFiles = new Set(allFiles)
  const countByDirectory = new Map()
  for (const file of allFiles) {
    if (!SOURCE.test(file) || ROOT_ENTRIES.has(file)) continue
    const directory = path.posix.dirname(file)
    countByDirectory.set(directory, (countByDirectory.get(directory) || 0) + 1)
  }
  return [...new Set(newFiles.filter((file) => presentFiles.has(file) && SOURCE.test(file) && !ROOT_ENTRIES.has(file))
    .map((file) => path.posix.dirname(file)))].sort()
    .filter((directory) => (countByDirectory.get(directory) || 0) > MAX_FILES_PER_DIRECTORY)
    .map((directory) => ({
      file: directory,
      reason: `${countByDirectory.get(directory)} implementation and test files exceed the ${MAX_FILES_PER_DIRECTORY}-file subdomain limit`,
    }))
}

function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT }) }
  catch { return Buffer.alloc(0) }
}

function paths(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean)
}

export function newImplementationPaths() {
  const adoption = git(['log', '-1', '--diff-filter=A', '--format=%H', '--', ADOPTION_ADR]).toString('utf8').trim()
  const requestedBase = process.env.WHARNEX_DOMAIN_LAYOUT_BASE || (adoption ? `${adoption}^` : BOOTSTRAP_BASE)
  const base = git(['merge-base', 'HEAD', requestedBase]).toString('utf8').trim()
  if (!base) throw new Error(`Domain layout adoption base is unavailable: ${requestedBase}`)
  return [...new Set([
    ...paths(git(['diff', '--find-renames', '--name-only', '--diff-filter=AR', '-z', `${base}...HEAD`, '--'])),
    ...paths(git(['diff', '--find-renames', '--cached', '--name-only', '--diff-filter=AR', '-z', '--'])),
    ...paths(git(['ls-files', '--others', '--exclude-standard', '-z'])),
  ])].sort()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const newFiles = newImplementationPaths()
  const allFiles = [...new Set([
    ...paths(git(['ls-files', '-z'])),
    ...paths(git(['ls-files', '--others', '--exclude-standard', '-z'])),
  ])].filter((file) => existsSync(path.join(ROOT, file)))
  const violations = newFiles
    .map((file) => ({ file, reason: domainLayoutViolation(file) }))
    .filter(({ reason }) => reason)
    .concat(overfullDirectoryViolations(newFiles, allFiles))
  for (const { file, reason } of violations) console.error(`${file}: ${reason}`)
  if (violations.length) process.exitCode = 1
  else console.log('New implementation files have domain owners')
}
