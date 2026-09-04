import path from 'node:path'
import { resolveLinuxOzonePlatform } from './security.mjs'

export function electronChildEnvironment(env = process.env) {
  const child = { ...env }
  delete child.ELECTRON_RUN_AS_NODE
  return child
}

export function resolveElectronBinary(defaultBinary, env = process.env) {
  const override = String(env.WHARNESS_ELECTRON_BINARY || '').trim()
  if (!override) return defaultBinary
  if (!path.isAbsolute(override)) throw new Error('WHARNESS_ELECTRON_BINARY must be an absolute path')
  return path.normalize(override)
}

export function electronLaunchArguments(platform = process.platform, env = process.env) {
  const args = ['.']
  if (platform !== 'linux') return { args, ozone: '' }
  const sandboxMode = String(env.WHARNESS_LINUX_SANDBOX_MODE || '').trim().toLowerCase()
  if (sandboxMode === 'userns') args.push('--disable-setuid-sandbox')
  const ozone = resolveLinuxOzonePlatform(env)
  args.push(`--ozone-platform=${ozone}`)
  if (ozone === 'wayland') {
    args.push('--disable-vulkan', '--disable-features=Vulkan')
  }
  return { args, ozone }
}
