export function parsePatternLines(value: string) {
  const seen = new Set<string>()
  return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).filter((line) => {
    if (seen.has(line)) return false
    seen.add(line)
    return true
  })
}

export function formatPatternLines(values: string[]) {
  return values.join('\n')
}

export function bytesToMiB(bytes: number) {
  return Math.max(1, Math.round(bytes / (1024 * 1024)))
}

export function miBToBytes(value: number) {
  return Math.max(1, Math.min(64, Math.round(value))) * 1024 * 1024
}
