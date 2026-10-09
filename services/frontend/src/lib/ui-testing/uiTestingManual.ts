import type { UIGuide, UITestCase, UITestingDocument } from '../../types'
import { dependencyOrder } from './uiTestingCatalog'

export type ManualEntry = { guide: UIGuide; test?: UITestCase; anchor: string }
export type ManualSection = { category: string; label: string; entries: ManualEntry[] }

const CATEGORY_ORDER = ['smoke', 'functional', 'validation', 'negative', 'permissions', 'regression', 'accessibility']
const CATEGORY_LABEL: Record<string, string> = {
  smoke: 'Primeiros passos', functional: 'Funcionalidades', validation: 'Validações de formulários', negative: 'Situações de erro',
  permissions: 'Perfis e permissões', regression: 'Verificações gerais', accessibility: 'Acessibilidade', other: 'Outros',
}

/**
 * The environment's manual: every guide of its tests, grouped by category in a
 * reading order — first-use flows before features, and within a group a
 * prerequisite before what depends on it.
 */
export function manualSections(doc: UITestingDocument, environmentId: string): ManualSection[] {
  const tests = new Map(doc.tests.map((test) => [test.id, test]))
  const groups = new Map<string, ManualEntry[]>()
  for (const guide of doc.guides) {
    const test = tests.get(guide.test_id)
    if ((test?.environment_id || '') !== environmentId) continue
    const category = CATEGORY_ORDER.includes(test?.category || '') ? test!.category! : 'other'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category)!.push({ guide, test, anchor: `guia-${guide.test_id}` })
  }
  const depth = (entry: ManualEntry) => entry.test ? dependencyOrder(doc, entry.test.id).length : 0
  return [...CATEGORY_ORDER, 'other'].filter((category) => groups.has(category)).map((category) => ({
    category, label: CATEGORY_LABEL[category],
    entries: groups.get(category)!.sort((a, b) => depth(a) - depth(b) || a.guide.title.localeCompare(b.guide.title, 'pt')),
  }))
}

/** Points a guide's `step-NN.png` references at that run's stored captures. */
export function resolveGuideImages(markdown: string, assetURL: (name: string) => string) {
  return String(markdown || '').replace(/\]\((step-\d{2}\.png)\)/g, (_match, name: string) => `](${assetURL(name)})`)
}
