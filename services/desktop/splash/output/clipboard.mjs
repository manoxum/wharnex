export function copySplashOutput(clipboard, entries) {
  try {
    const text = entries.map((entry) => `[${String(entry.at || '').slice(11, 19)}] ${entry.text}`).join('\n')
    if (!text) return false
    clipboard.writeText(text)
    return true
  } catch { return false }
}
