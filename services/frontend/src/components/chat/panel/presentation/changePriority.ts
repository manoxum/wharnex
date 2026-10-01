import type { ChatChangeFile } from '../../../../types'

export function isNormativeChangePath(path: string) {
  const normalized = path.replace(/^\.\//, '')
  return normalized === 'AGENTS.md' || normalized.startsWith('SoT/')
}

export function prioritizedChangeFiles(files: ChatChangeFile[]) {
  return files.map((file, index) => ({ file, index }))
    .sort((left, right) => Number(isNormativeChangePath(right.file.path)) - Number(isNormativeChangePath(left.file.path)) || left.index - right.index)
    .map(({ file }) => file)
}
