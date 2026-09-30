import { readFileSync } from 'node:fs'

const VERSION_PATTERN = /^v\d+\.\d+\.\d+\.\d+$/

export function normalizeProjectVersion(value) {
  const version = String(value ?? '').trim()
  return VERSION_PATTERN.test(version) ? version : ''
}

export function readProjectVersion(file = new URL('../../../VERSION', import.meta.url)) {
  try { return normalizeProjectVersion(readFileSync(file, 'utf8')) }
  catch { return '' }
}
