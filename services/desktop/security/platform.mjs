export function resolveLinuxOzonePlatform(env = {}) {
  const requested = String(env.WHARNESS_OZONE_PLATFORM || '').trim().toLowerCase()
  if (requested === 'x11' || requested === 'wayland') return requested
  if (env.DISPLAY) return 'x11'
  return 'wayland'
}

export function chromeCompatibleUserAgent(platform = process.platform, chromiumVersion = '152.0.7977.65') {
  const version = String(chromiumVersion || '152.0.7977.65').replace(/[^0-9.]/g, '') || '152.0.7977.65'
  const os = platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`
}
