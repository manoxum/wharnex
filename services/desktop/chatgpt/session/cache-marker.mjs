import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

// The filename is persisted state and keeps its shipped spelling.
const CACHE_MARKER_FILENAME = 'wharness-chatgpt-cache-marker.json'

export function createChatGPTCacheMarker({ userDataPath, chromiumVersion }) {
  const filename = () => path.join(userDataPath(), CACHE_MARKER_FILENAME)

  function current() {
    try { return JSON.parse(readFileSync(filename(), 'utf8'))?.chromiumVersion === chromiumVersion }
    catch { return false }
  }

  function write() {
    try { writeFileSync(filename(), JSON.stringify({ chromiumVersion }), { mode: 0o600 }) }
    catch (error) { console.warn(`[chatgpt-cache] marker write failed: ${error instanceof Error ? error.message : String(error)}`) }
  }

  return { current, write }
}
