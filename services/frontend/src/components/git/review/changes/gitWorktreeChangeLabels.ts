import type { GitOverview } from '../../../../types'

export function gitWorktreeKindLabel(kind: GitOverview['working']['files'][number]['kind']) {
  return ({ change: 'alterado', gitlink: 'gitlink alterado', submodule: 'submódulo com alterações', embedded_repository: 'repositório embebido', unmerged: 'conflito não resolvido' } as const)[kind]
}
