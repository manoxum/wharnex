import { createHash } from 'node:crypto'

const DEFAULT_INSTANCE = 'WHX'
// The brand accent, and the one `services/frontend/public/favicon.svg` carries.
export const BRAND_ACCENT = '#b9ff56'
const ACCENTS = [BRAND_ACCENT, '#55d6ff', '#c792ff', '#ffb454', '#ff6b9a', '#53e3a6']

export function desktopInstanceName(value = process.env.WHARNESS_INSTANCE_ID) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return normalized || DEFAULT_INSTANCE
}

export function projectDisplayName(projectPath) {
  const normalized = String(projectPath || '').replace(/[\\/]+$/, '')
  const name = normalized.split(/[\\/]/).pop()?.trim()
  return name?.slice(0, 120) || ''
}

export function desktopWindowTitle(projectPath, instance = process.env.WHARNESS_INSTANCE_ID) {
  const project = projectDisplayName(projectPath)
  const suffix = desktopInstanceName(instance)
  return project ? `Wharnex · ${project} · ${suffix}` : `Wharnex · ${suffix}`
}

export function desktopAccent(instance = process.env.WHARNESS_INSTANCE_ID) {
  const digest = createHash('sha256').update(desktopInstanceName(instance)).digest()[0]
  return ACCENTS[digest % ACCENTS.length]
}

export function desktopIconSVG(instance = process.env.WHARNESS_INSTANCE_ID) {
  const accent = desktopAccent(instance)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111310"/><g fill="none" stroke="${accent}" stroke-linecap="round"><circle cx="32" cy="32" r="23.5" stroke-width="4.1" stroke-dasharray="22 13" transform="rotate(24 32 32)" opacity=".82"/><circle cx="32" cy="32" r="14.5" stroke-width="4.7" stroke-dasharray="15 8" transform="rotate(-18 32 32)" opacity=".95"/></g><circle cx="32" cy="32" r="6.7" fill="${accent}"/></svg>`
}
