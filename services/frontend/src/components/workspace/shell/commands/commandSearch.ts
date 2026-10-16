import type { WorkbenchCommand } from './commandTypes'

const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
export function searchCommands(commands: WorkbenchCommand[], query: string) {
  const words = searchable(query).trim().split(/\s+/).filter(Boolean)
  return commands.filter((command) => {
    const text = searchable(`${command.label} ${command.description} ${command.group || ''}`)
    return words.every((word) => text.includes(word))
  })
}
