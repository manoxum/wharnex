export function pairingCodeFromScan(value: string, origin = window.location.origin) {
  const clean = value.trim()
  if (!clean) return ''
  try {
    const target = new URL(clean)
    if (target.origin !== origin) return ''
    return target.searchParams.get('pair')?.trim() || ''
  } catch {
    return /^[A-Za-z0-9_-]{8,256}$/.test(clean) ? clean : ''
  }
}
