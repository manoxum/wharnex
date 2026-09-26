#!/usr/bin/env node
// Completes a node_modules tree with the native packages of the *other* libc.
//
// The same checkout is installed by two runtimes: the operator's host (glibc)
// and the backend container that runs self-evolution builds (Alpine, musl).
// `npm ci` installs only the variant of its own libc, so each install left a
// tree the other side could not load — after a self-evolution build the host's
// vitest failed with "Cannot find module ../lightningcss.linux-x64-gnu.node".
// Every variant is already pinned in package-lock.json; this installs the
// missing ones for the current OS and CPU, byte-verified against the lock's
// integrity, without touching anything npm installed.
//
// Usage: hydrate-native-variants.mjs <service-dir> [npm-cache-dir]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// selectMissingVariants lists the lockfile's libc-specific packages for this
// OS and CPU that are not installed yet.
export function selectMissingVariants(lock, serviceDir, platform = process.platform, arch = process.arch) {
  return Object.entries(lock.packages || {}).filter(([location, entry]) =>
    location.startsWith('node_modules/') &&
    Array.isArray(entry.libc) && entry.version && entry.integrity &&
    (!entry.os || entry.os.includes(platform)) &&
    (!entry.cpu || entry.cpu.includes(arch)) &&
    !existsSync(path.join(serviceDir, location, 'package.json')))
}

function main(serviceDir, cacheDir) {
  if (!serviceDir) {
    console.error('usage: hydrate-native-variants.mjs <service-dir> [npm-cache-dir]')
    return 2
  }
  const lockPath = path.join(serviceDir, 'package-lock.json')
  if (!existsSync(lockPath) || !existsSync(path.join(serviceDir, 'node_modules'))) return 0
  const missing = selectMissingVariants(JSON.parse(readFileSync(lockPath, 'utf8')), serviceDir)
  const cacheArgs = cacheDir ? ['--cache', cacheDir] : []
  for (const [location, entry] of missing) {
    const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length)
    const workdir = mkdtempSync(path.join(tmpdir(), 'wharnex-native-'))
    try {
      const packed = JSON.parse(execFileSync('npm', ['pack', `${name}@${entry.version}`, '--json', '--prefer-offline', '--silent', '--pack-destination', workdir, ...cacheArgs], { encoding: 'utf8' }))[0]
      if (packed.integrity !== entry.integrity) throw new Error(`integrity mismatch: lock ${entry.integrity}, fetched ${packed.integrity}`)
      const target = path.join(serviceDir, location)
      mkdirSync(target, { recursive: true })
      execFileSync('tar', ['-xzf', path.join(workdir, packed.filename), '-C', target, '--strip-components=1'])
      console.log(`[deps] native variant ${name}@${entry.version} (${entry.libc.join(',')}) hydrated`)
    } catch (error) {
      console.warn(`[deps] native variant ${name}@${entry.version} unavailable: ${error instanceof Error ? error.message.split('\n')[0] : error}`)
    } finally {
      rmSync(workdir, { recursive: true, force: true })
    }
  }
  // A missing foreign-libc variant never breaks this runtime's own build: it is
  // reported, and the other runtime's next install supplies its own variant.
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv[2], process.argv[3]))
