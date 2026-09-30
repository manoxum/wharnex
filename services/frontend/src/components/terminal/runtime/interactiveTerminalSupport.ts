export const MAX_PERSISTED_TERMINAL_HISTORY = 256 * 1024

const terminalThemes = {
  dark: {
    background: '#151715', foreground: '#D8DDD7', cursor: '#9FCB73', selectionBackground: '#3C473588',
    black: '#111311', red: '#E27676', green: '#9FCB73', yellow: '#D8BB70', blue: '#7DA7D9',
    magenta: '#B58AC9', cyan: '#71B7B0', white: '#D8DDD7', brightBlack: '#747B74',
    brightRed: '#EE9188', brightGreen: '#B5DD8B', brightYellow: '#E4CB91', brightBlue: '#9ABEE5',
    brightMagenta: '#CBA6DA', brightCyan: '#92CEC7', brightWhite: '#F0F2EE',
  },
  light: {
    background: '#f7f8f4', foreground: '#30362e', cursor: '#527c20', selectionBackground: '#cadab8aa',
    black: '#20241d', red: '#a54038', green: '#39734b', yellow: '#996117', blue: '#4777a5',
    magenta: '#8d5aa1', cyan: '#397e75', white: '#e8ebe5', brightBlack: '#697066',
    brightRed: '#c55f55', brightGreen: '#557d24', brightYellow: '#b77a26', brightBlue: '#5b8fbe',
    brightMagenta: '#a86aba', brightCyan: '#4b978d', brightWhite: '#ffffff',
  },
  'high-contrast': {
    background: '#000000', foreground: '#ffffff', cursor: '#ffffff', selectionBackground: '#ffffff55',
    black: '#000000', red: '#ff6b6b', green: '#7dff7d', yellow: '#fff56b', blue: '#70b7ff',
    magenta: '#ff8cff', cyan: '#72ffff', white: '#ffffff', brightBlack: '#a0a0a0',
    brightRed: '#ff9494', brightGreen: '#a6ffa6', brightYellow: '#fff99a', brightBlue: '#9bd0ff',
    brightMagenta: '#ffb2ff', brightCyan: '#adffff', brightWhite: '#ffffff',
  },
}

export function activeTerminalTheme() {
  const scheme = document.documentElement.dataset.contentScheme
  return terminalThemes[scheme === 'light' || scheme === 'high-contrast' ? scheme : 'dark']
}

export function splitTerminalInput(data: string) {
  const chunks: string[] = []
  let chunk = ''
  let bytes = 0
  const encoder = new TextEncoder()
  for (const character of data) {
    const size = encoder.encode(character).length
    if (bytes + size > 60_000 && chunk) { chunks.push(chunk); chunk = ''; bytes = 0 }
    chunk += character; bytes += size
  }
  if (chunk) chunks.push(chunk)
  return chunks
}
