import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

let composed

// Test support: the dependency shapes of the fully composed Desktop context,
// produced once per test process by composing it in an isolated child.
export function readComposedDesktopContext() {
  composed ??= new Promise((resolve, reject) => {
    const file = (name) => fileURLToPath(new URL(name, import.meta.url))
    execFile(process.execPath, ['--import', file('./register.mjs'), file('./probe.mjs')], {
      // The probe must never reach a live backend or a real Desktop profile.
      env: {
        ...process.env, WHARNESS_API_URL: 'http://127.0.0.1:9', WHARNESS_FRONTEND_URL: 'http://127.0.0.1:9',
        WHARNESS_DESKTOP_DATA_HOME: tmpdir(),
      },
      timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`Desktop composition failed: ${stderr || error.message}`))
      resolve(JSON.parse(stdout.trim().split('\n').at(-1)))
    })
  })
  return composed
}
