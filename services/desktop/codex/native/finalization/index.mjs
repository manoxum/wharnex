import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { devNull } from 'node:os'

const execute = promisify(execFile)
const scope = new AsyncLocalStorage()
async function git(root, ...args) {
  const record = scope.getStore() || {}
  const context = `operation=${args.includes('commit') ? 'commit' : args[0]} chat=${record.chatId || ''} session=${record.sessionId || ''} request=${record.requestId || ''}`
  console.info(`[codex] native git started ${context}`)
  try {
    const result = await execute('git', ['--literal-pathspecs', '-C', root, ...args], {
      timeout: 30000, maxBuffer: 4 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    console.info(`[codex] native git completed ${context}`)
    return result.stdout
  } catch (error) { console.warn(`[codex] native git failed ${context} code=${Number(error.code) || 0}`); throw error }
}
async function dirty(root) {
  const entries = (await git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all')).split('\0')
  const paths = []
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue
    paths.push(entries[i].slice(3))
    if (/[RC]/.test(entries[i].slice(0, 2))) paths.push(entries[++i])
  }
  return paths
}
export function captureNativeBaseline(root, record = {}) {
  return scope.run(record, () => capture(root))
}
async function capture(root) {
  try {
    if (path.resolve((await git(root, 'rev-parse', '--show-toplevel')).trim()) !== path.resolve(root)) return null
    if (!await safe(root, 'VERSION')) return null
    const metadata = await lstat(path.join(root, 'VERSION')).catch((error) => { if (error.code === 'ENOENT') return null; throw error })
    if (metadata && (!metadata.isFile() || metadata.size > 128)) return null
    const version = await readFile(path.join(root, 'VERSION'), 'utf8').catch((error) => { if (error.code === 'ENOENT') return null; throw error })
    if (version !== null && !/^v\d+\.\d+\.\d+\.\d+\s*$/.test(version)) return null
    return { head: (await git(root, 'rev-parse', 'HEAD')).trim(), dirty: await dirty(root), version }
  } catch { return null }
}
async function safe(root, filename) {
  if (!filename || path.isAbsolute(filename) || filename.split(/[\\/]/).some((part) => !part || ['..', '.git', '.ssh', '.codex', '.harness'].includes(part)) || /(?:^|\/)(?:\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|.*\.(?:pem|key))$/i.test(filename)) return false
  let current = root
  for (const part of filename.split('/')) {
    current = path.join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) return false } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return true
}
export async function finalizeNativeChanges(record) {
  const result = { id: 'native-finalization', type: 'nativeResult', status: 'completed', changes: [], explanation: '' }
  try {
    return await scope.run(record, () => finalize(record, result))
  } catch {
    return { ...result, status: 'failed', changes: result.changes.filter((change) => change.path !== 'VERSION'), explanation: 'O fecho Git falhou. Reveja a identidade Git, VERSION e as alterações antes de fazer o commit manualmente.' }
  }
}
async function finalize(record, result) {
  const baseline = record.gitBaseline, root = record.projectPath
  if (!baseline) return { ...result, status: 'failed', explanation: 'Fecho Git indisponível: o projeto precisa de um repositório com um commit inicial.' }
  if (baseline.concurrent) return { ...result, status: 'failed', explanation: 'Pedidos nativos sobrepostos neste projeto. Reveja os diffs no Git e faça o commit manualmente.' }
  const declared = new Set((record.nativeChangedPaths || (record.activities || []).filter((item) => item.type === 'fileChange').flatMap((item) => item.changes || []).map((change) => change.path)).map((name) => path.isAbsolute(name) ? path.relative(root, name) : name))
  const changed = await dirty(root)
  const paths = []
  for (const filename of changed) if (declared.has(filename) && filename !== 'VERSION' && await safe(root, filename)) paths.push(filename)
  if (!paths.length) return { ...result, explanation: 'Sem alterações nativas elegíveis para commit.' }
  for (const filename of paths) {
    let diff = await git(root, 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', filename)
    let kind = 'update'
    if (!diff) {
      // Untracked text is included only after the same path/symlink checks.
      const metadata = await lstat(path.join(root, filename))
      const bytes = metadata.size <= 65536 ? await readFile(path.join(root, filename)) : null
      kind = 'add'
      if (!bytes || bytes.includes(0)) diff = `Binary files /dev/null and b/${filename} differ\n`
      else {
        const text = bytes.toString('utf8'), lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
        diff = `--- /dev/null\n+++ b/${filename}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}\n`).join('')}${text.endsWith('\n') ? '' : '\\ No newline at end of file\n'}`
      }
    }
    result.changes.push({ path: filename, diff, kind: { type: diff.includes('deleted file mode') ? 'delete' : kind } })
  }
  if (paths.some((filename) => baseline.dirty.includes(filename)) || baseline.dirty.includes('VERSION')) return { ...result, status: 'failed', explanation: 'Existem alterações anteriores ao pedido nos ficheiros afetados. Reveja o Git e faça o commit manualmente.' }
  if ((await git(root, 'rev-parse', 'HEAD')).trim() !== baseline.head) return { ...result, status: 'failed', explanation: 'O HEAD mudou durante o pedido. Reveja o Git antes de criar o commit.' }
  const versionPath = path.join(root, 'VERSION')
  if (!await safe(root, 'VERSION')) throw new Error('VERSION não pode ser um link simbólico.')
  const currentVersion = await readFile(versionPath, 'utf8').catch((error) => { if (error.code === 'ENOENT') return null; throw error })
  if (currentVersion !== baseline.version) throw new Error('VERSION foi alterado durante o pedido. Reveja o Git antes de continuar.')
  const before = currentVersion ?? 'v0.0.0.0\n'
  if (!/^v\d+\.\d+\.\d+\.\d+\s*$/.test(before)) throw new Error('VERSION deve usar o formato vA.B.C.D.')
  const parts = before.trim().slice(1).split('.').map(BigInt)
  parts[3] += 1n
  const version = `v${parts.join('.')}`
  result.changes.push({ path: 'VERSION', diff: `--- a/VERSION\n+++ b/VERSION\n@@ -1 +1 @@\n-${before.trim()}\n+${version}`, kind: { type: 'update' } })
  if (record.gitCommitMode === 'manual') {
    await writeFile(versionPath, `${version}\n`)
    return { ...result, explanation: `Execução nativa · versão ${version} · commit manual pendente no Git.` }
  }
  // Check identity before changing engine-owned metadata.
  await git(root, 'var', 'GIT_AUTHOR_IDENT')
  await writeFile(versionPath, `${version}\n`)
  try {
    await git(root, 'add', '--', ...paths, 'VERSION')
    await git(root, '-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', 'commit', '--no-verify', '--only', '-m', `chore(codex): ${record.title || 'native changes'} (${version})`, '--', ...paths, 'VERSION')
  } catch (error) {
    if (baseline.version === null) await unlink(versionPath)
    else await writeFile(versionPath, before)
    await git(root, 'reset', '-q', 'HEAD', '--', ...paths, 'VERSION')
    throw error
  }
  const sha = (await git(root, 'rev-parse', 'HEAD')).trim()
  result.explanation = `Execução nativa · commit ${sha} · versão ${version}`
  return result
}
