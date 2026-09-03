import { resolveLinuxOzonePlatform } from './security.mjs'

export function electronChildEnvironment(env = process.env) {
  const child = { ...env }
  delete child.ELECTRON_RUN_AS_NODE
  return child
}

export function electronLaunchArguments(platform = process.platform, env = process.env) {
  const args = ['.']
  if (platform !== 'linux') return { args, ozone: '' }
  const ozone = resolveLinuxOzonePlatform(env)
  args.push(`--ozone-platform=${ozone}`)
  if (ozone === 'wayland') {
    args.push('--disable-vulkan', '--disable-features=Vulkan')
  }
  return { args, ozone }
}
