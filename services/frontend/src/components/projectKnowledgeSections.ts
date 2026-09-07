export type KnowledgeSection = { id: string; title: string; markdown: string }

export function splitKnowledgeSections(markdown: string): KnowledgeSection[] {
  const lines = markdown.split(/\r?\n/)
  const sections: KnowledgeSection[] = []
  let title = 'Visão geral'
  let buffer: string[] = []
  let index = 0
  const flush = () => {
    const content = buffer.join('\n').trim()
    if (!content) return
    sections.push({ id: `section-${index++}`, title, markdown: content })
  }
  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+?)\s*#*\s*$/)
    if (heading) {
      flush()
      title = heading[1].trim()
      buffer = [line]
    } else {
      buffer.push(line)
    }
  }
  flush()
  return sections.length ? sections : [{ id: 'section-0', title: 'Documento completo', markdown }]
}
