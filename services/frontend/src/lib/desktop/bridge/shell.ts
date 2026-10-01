export function parseArgv(input: string): string[] {
  const argv: string[] = []
  let current = ''
  let quote: 'single' | 'double' | undefined
  let escaped = false

  for (const char of input.trim()) {
    if (escaped) { current += char; escaped = false; continue }
    if (char === '\\' && quote !== 'single') { escaped = true; continue }
    if (char === "'" && quote !== 'double') { quote = quote === 'single' ? undefined : 'single'; continue }
    if (char === '"' && quote !== 'single') { quote = quote === 'double' ? undefined : 'double'; continue }
    if (/\s/.test(char) && !quote) {
      if (current) { argv.push(current); current = '' }
      continue
    }
    current += char
  }
  if (escaped) current += '\\'
  if (quote) throw new Error('Aspas não fechadas no comando')
  if (current) argv.push(current)
  return argv
}
