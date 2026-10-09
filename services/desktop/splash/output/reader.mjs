import { createFileTail } from './file-tail.mjs'
import { createOutputRedactor } from './redaction.mjs'

export function createSplashOutputReader({ outputFile = '', desktopFile = '', environment = process.env } = {}) {
  const redact = createOutputRedactor(environment)
  const startup = createFileTail(outputFile)
  const desktop = createFileTail(desktopFile, { startAtEnd: true, chunkBytes: 32 * 1024 })
  const history = []
  return ({ drain = false } = {}) => {
    const startupEnd = drain ? startup.boundary() : Infinity
    const desktopEnd = drain ? desktop.boundary() : Infinity
    let caughtUp
    do {
      const output = startup({ end: startupEnd })
      const diagnostic = desktop({ end: desktopEnd })
      const entries = []
      for (const line of output.lines) {
        try {
          const row = JSON.parse(line)
          if (!['stdout', 'stderr'].includes(row?.stream)) continue
          entries.push({ stream: row.stream, source: redact(row.source).slice(0, 80), text: redact(row.text), at: String(row.at || '').slice(0, 30) })
        } catch { /* ignore an incomplete or malformed journal row */ }
      }
      entries.push(...diagnostic.lines.map((text) => ({ stream: 'desktop', source: 'Desktop', text: redact(text), at: new Date().toISOString() })))
      history.push(...entries.sort((a, b) => String(a.at).localeCompare(String(b.at))))
      caughtUp = output.caughtUp && diagnostic.caughtUp
    } while (drain && !caughtUp)
    return history
  }
}
