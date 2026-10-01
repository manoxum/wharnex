export type DirectiveKind = 'file' | 'ref' | 'attach' | 'see' | 'chat' | 'lib' | 'todo'

export type ComposerDirective = {
  kind: DirectiveKind
  value: string
  raw: string
  start: number
  end: number
}

const kinds: DirectiveKind[] = ['file', 'ref', 'attach', 'see', 'chat', 'lib', 'todo']
const aliases: Record<string, DirectiveKind> = {
  file: 'file', ref: 'ref', reference: 'ref', references: 'ref', project: 'ref',
  attach: 'attach', att: 'attach', dir: 'attach', see: 'see', look: 'see',
  chat: 'chat', lib: 'lib', library: 'lib', todo: 'todo',
}

const canonical = /@\{\[(file|ref|attach|see|chat|lib|todo)\]([^{}\n]+)\}/g
const typed = /@(file|ref|reference|references|project|attach|att|dir|see|look|chat|lib|library|todo):(?:<<([^<>\n]+)>>|([^\s<>{}(),;:!?"'`]+))/gi

export function makeDirective(kind: DirectiveKind, value: string) {
  return `@{[${kind}]${value}}`
}

export function parseDirectives(text: string): ComposerDirective[] {
  const found: ComposerDirective[] = []
  const collect = (regex: RegExp, typedForm: boolean) => {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const kind = typedForm ? aliases[match[1].toLowerCase()] : match[1] as DirectiveKind
      const value = (typedForm ? (match[2] ?? match[3]) : match[2])?.trim() || ''
      if (!kind || !value) continue
      found.push({ kind, value, raw: match[0], start: match.index, end: match.index + match[0].length })
    }
  }
  collect(canonical, false)
  collect(typed, true)
  return found.sort((left, right) => left.start - right.start).filter((item, index, all) => index === 0 || item.start >= all[index - 1].end)
}

export function removeDirective(text: string, directive: Pick<ComposerDirective, 'start' | 'end'>) {
  const before = text.slice(0, directive.start).replace(/[ \t]+$/, '')
  const after = text.slice(directive.end).replace(/^[ \t]+/, '')
  const spacer = before && after && !before.endsWith('\n') && !after.startsWith('\n') ? ' ' : ''
  return `${before}${spacer}${after}`
}

export const directiveKinds = kinds
