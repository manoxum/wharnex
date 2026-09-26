import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { selectMissingVariants } from './hydrate-native-variants.mjs'

const lock = {
  packages: {
    '': { name: 'service' },
    'node_modules/lightningcss-linux-x64-gnu': { version: '1.0.0', integrity: 'sha512-gnu', os: ['linux'], cpu: ['x64'], libc: ['glibc'], optional: true },
    'node_modules/lightningcss-linux-x64-musl': { version: '1.0.0', integrity: 'sha512-musl', os: ['linux'], cpu: ['x64'], libc: ['musl'], optional: true },
    'node_modules/lightningcss-darwin-arm64': { version: '1.0.0', integrity: 'sha512-mac', os: ['darwin'], cpu: ['arm64'], optional: true },
    'node_modules/esbuild': { version: '1.0.0', integrity: 'sha512-esbuild' },
  },
}

test('selects only the uninstalled libc variants for this OS and CPU', () => {
  const service = mkdtempSync(path.join(tmpdir(), 'native-variants-'))
  const installed = path.join(service, 'node_modules', 'lightningcss-linux-x64-gnu')
  mkdirSync(installed, { recursive: true })
  writeFileSync(path.join(installed, 'package.json'), '{}')
  const missing = selectMissingVariants(lock, service, 'linux', 'x64').map(([location]) => location)
  assert.deepEqual(missing, ['node_modules/lightningcss-linux-x64-musl'])
})

test('selects nothing on a platform without libc-specific packages', () => {
  const service = mkdtempSync(path.join(tmpdir(), 'native-variants-'))
  assert.deepEqual(selectMissingVariants(lock, service, 'darwin', 'arm64'), [])
})
