import type { ConnectionStatus } from './InteractiveTerminal'

export function statusLabel(status: ConnectionStatus) {
  return ({ connecting: 'a ligar…', connected: 'ligado', closed: 'encerrado', error: 'erro' })[status]
}

export function inDirectory(cwd: string, command: string) {
  if (!cwd || cwd === '.') return command
  return `cd ${shellQuote(cwd)} && ${command}`
}

function shellQuote(value: string) { return `'${value.replace(/'/g, `'"'"'`)}'` }
