import type { ChatItem } from '../../../types'

export function latestTodoSnapshot(items: ChatItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].role !== 'harness') continue
    const todos = extractTodo(items[index].text)
    if (todos.length) return todos
  }
  return []
}

export function extractTodo(markdown: string) {
  const match = /(?:^|\n)##\s+TODO\s*\n([\s\S]*?)(?=\n##\s+|$)/i.exec(markdown || '')
  if (!match) return []
  return match[1].split('\n').map((line) => /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line)).filter((value): value is RegExpExecArray => Boolean(value)).map((value) => ({ done: value[1].toLowerCase() === 'x', text: value[2] }))
}

export function stripTodoSection(markdown: string) {
  return String(markdown || '').replace(/(?:^|\n)##\s+TODO\s*\n[\s\S]*?(?=\n##\s+|$)/i, '').trim()
}
