import type { UIGuide, UITestCase, UITestEnvironment, UITestingDocument, UITestSession } from '../../types'

export type EnvironmentGroup<T> = { environment: UITestEnvironment; items: T[] }

/** Groups items by environment in catalog order; unknown environments get a placeholder group. */
export function groupByEnvironment<T>(doc: UITestingDocument, items: T[], environmentOf: (item: T) => string): EnvironmentGroup<T>[] {
  const groups = new Map<string, EnvironmentGroup<T>>()
  for (const environment of doc.environments) groups.set(environment.id, { environment, items: [] })
  for (const item of items) {
    const id = environmentOf(item)
    if (!groups.has(id)) groups.set(id, { environment: { id, name: id || 'Sem ambiente', profiles: [] }, items: [] })
    groups.get(id)!.items.push(item)
  }
  return [...groups.values()].filter((group) => group.items.length > 0)
}

export function guideEnvironment(doc: UITestingDocument, guide: UIGuide) {
  return doc.tests.find((test) => test.id === guide.test_id)?.environment_id || ''
}

/** Prerequisites of a test in execution order (the backend's order, mirrored). */
export function dependencyOrder(doc: UITestingDocument, testId: string): UITestCase[] {
  const byId = new Map(doc.tests.map((test) => [test.id, test]))
  const order: UITestCase[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const test = byId.get(id)
    for (const dep of test?.depends_on || []) visit(dep)
    if (test && id !== testId) order.push(test)
  }
  visit(testId)
  return order
}

export function effectiveAccess(test: UITestCase) {
  return test.access || (test.profile_id || test.depends_on?.length ? 'authenticated' : 'public')
}

/** The profile a test's session runs under: its own, or the one its chain signs in with. */
export function effectiveProfileId(doc: UITestingDocument, test: UITestCase) {
  return test.profile_id || dependencyOrder(doc, test.id).map((dep) => dep.profile_id).find(Boolean) || ''
}

export function configurationIssue(doc: UITestingDocument, test: UITestCase) {
  const environment = doc.environments.find((candidate) => candidate.id === test.environment_id)
  if (!environment) return `O ambiente “${test.environment_id}” do teste “${test.title}” não existe.`
  if (!environment.url?.trim()) return `Configure a URL do ambiente “${environment.name}” antes de executar.`
  const profileId = effectiveProfileId(doc, test)
  if (!profileId) return ''
  const profile = environment.profiles.find((candidate) => candidate.id === profileId)
  if (!profile?.configured) return `Configure o perfil “${profile?.label || profileId}” do ambiente “${environment.name}” antes de executar.`
  return ''
}

/** The newest still-valid persisted session captured after this test passed. */
export function validSessionFor(doc: UITestingDocument, testId: string): UITestSession | undefined {
  return (doc.sessions || []).find((session) => session.test_id === testId && session.valid)
}
