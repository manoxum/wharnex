import { chmod, copyFile, lstat, mkdir, realpath, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// Transfer only the owned native transcript. Authentication is runtime-owned.
export async function transferOwnedRollout(record, sourceHome, targetHome) {
  if (!record.rolloutPath || !record.threadId) throw new Error('A conversa não tem histórico nativo para continuar noutra conta.')
  const source = await realpath(record.rolloutPath)
  const sessions = await realpath(path.join(sourceHome, 'sessions'))
  if (!source.startsWith(`${sessions}${path.sep}`) || path.basename(source).includes(record.threadId) === false) throw new Error('Histórico Codex fora da sessão autorizada.')
  const stat = await lstat(record.rolloutPath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 << 20) throw new Error('Histórico Codex inválido.')
  const directory = path.join(targetHome, 'sessions', 'wharnex')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const destination = path.join(directory, path.basename(source)), temporary = `${destination}.${randomUUID()}.tmp`
  await copyFile(source, temporary); await chmod(temporary, 0o600); await rename(temporary, destination)
  return destination
}
