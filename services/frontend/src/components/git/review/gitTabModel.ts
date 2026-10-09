import type { GitTab } from './GitTabs'
export function gitTabLabel(tab: GitTab) {
  return ({ changes: 'Alterações', history: 'Histórico', contributors: 'Contribuidores', branches: 'Branches', settings: 'Definições' } as const)[tab]
}
