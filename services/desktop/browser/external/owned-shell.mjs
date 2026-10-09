import { spawn as spawnProcess } from 'node:child_process'
import { mkdirSync, readlinkSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveManagedBrowserExecutable } from '../../chatgpt/session/managed-browser-auth.mjs'

export function ownedLinkProfileDirectory(userDataPath) {
  if (!String(userDataPath || '').trim()) throw new Error('Diretório userData inválido para o navegador Wharnex.')
  const root = path.resolve(String(userDataPath))
  if (root === path.parse(root).root) throw new Error('Diretório userData inválido para o navegador Wharnex.')
  return path.join(root, 'ManagedBrowser', 'LinkProfile')
}

export function requireBrowserUpLink(platform = process.platform, readlink = readlinkSync, parentPid = process.ppid) {
  if (platform !== 'linux') return
  const current = readlink('/proc/self/ns/net')
  const host = readlink(`/proc/${parentPid}/ns/net`)
  if (current === host) throw new Error('Navegador externo bloqueado: Desktop fora de up-whx-link.')
}

export function createOwnedBrowserShell({ app, nativeShell, platform = process.platform,
  spawn = spawnProcess, executable = () => resolveManagedBrowserExecutable(),
  requireUpLink = () => requireBrowserUpLink(platform),
  sessionId = randomUUID(),
} = {}) {
  const children = new Set()
  const profileRoot = () => ownedLinkProfileDirectory(app.getPath('userData'))
  const profilePath = () => path.join(profileRoot(), sessionId)

  async function openExternal(value) {
    const url = new URL(String(value))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('URL externa não permitida.')
    requireUpLink()
    const browser = executable()
    if (!browser) throw new Error('Chrome/Chromium/Brave não encontrado para abrir a URL em up-whx-link.')
    const profile = profilePath()
    mkdirSync(profile, { recursive: true, mode: 0o700 })
    const child = spawn(browser, [
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      '--new-window', url.href,
    ], { stdio: 'ignore', windowsHide: false })
    children.add(child)
    child.once('exit', () => children.delete(child))
    try {
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
    } catch (error) {
      children.delete(child)
      throw new Error(`Não foi possível iniciar o navegador em up-whx-link: ${error.message}`)
    }
  }

  function closeAll() {
    for (const child of children) {
      try { child.kill('SIGTERM') } catch { /* browser may already have exited */ }
    }
    children.clear()
  }

  return { openExternal, openPath: (...args) => nativeShell.openPath(...args), closeAll, profileRoot }
}
