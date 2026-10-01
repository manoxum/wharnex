import { type ComposerDirective, type DirectiveQuery } from '../../../lib/chat/composer/composerDirectives'

// What the directive menu says when it has nothing to offer.
//
// "Nothing found" is the wrong answer to "@ref: in a workspace with one bound
// project": the operator has not made a mistake, there is simply nothing else
// bound yet, and saying so points at the action that fixes it.
export function directiveMenuHint(query: DirectiveQuery, results: number, knownProjects: number) {
  if (results) {
    if (query.kind === 'ref') return 'Escolha um projeto já trabalhado ou um ficheiro dele'
    if (query.kind === 'see') return query.query.includes('|') ? 'Escolha o alvo dentro desta referência já indexada' : 'Escolha uma fonte já indexada no composer'
    if (query.kind === 'todo') return 'Escolha um TODO do projeto; pode referenciar vários no mesmo pedido'
    if (query.kind === 'task') return 'Escolha uma task concluída; o ID distingue títulos semelhantes'
    return 'Escolha um ficheiro do contexto'
  }
  if (query.kind === 'file') return 'Nenhum ficheiro elegível encontrado'
  if (query.kind === 'todo') return 'Nenhum TODO corresponde'
  if (query.kind === 'task') return 'Nenhuma task concluída corresponde'
  if (query.kind === 'see') return query.query.includes('|') ? 'Nenhum alvo desta referência corresponde' : 'Indexe primeiro um anexo ou referência no composer'
  if (!knownProjects) return 'Nenhum outro projeto conhecido por este Wharnex'
  return 'Nenhum projeto ou ficheiro corresponde'
}

/** Icon used for each directive kind in the insertion menu. */
export function directiveKindIcon(kind: ComposerDirective['kind']) {
  if (kind === 'attach') return 'folder'
  if (kind === 'todo' || kind === 'task') return 'check'
  if (kind === 'file') return 'file'
  if (kind === 'see') return 'link'
  return 'workspace'
}
