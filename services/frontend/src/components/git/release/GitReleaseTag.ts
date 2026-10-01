export function releaseTagName(version: string, suffix: string) {
  const base = version.trim()
  const trimmedSuffix = suffix.trim().replace(/^-+/, '')
  if (!base) return ''
  return trimmedSuffix ? `${base}-${trimmedSuffix}` : base
}
