import { describe, expect, it } from 'vitest'
import type { UITestingDocument } from '../../types'
import { configurationIssue, dependencyOrder, effectiveAccess, effectiveProfileId, groupByEnvironment } from './uiTestingCatalog'

const doc: UITestingDocument = {
  project_id: '/demo', sync_status: 'ready', auto_run_changes: true, runs: [], guides: [],
  environments: [
    { id: 'web', name: 'Web', url: 'https://app.test', profiles: [{ id: 'admin', label: 'Admin', role: 'admin', configured: false }] },
    { id: 'site', name: 'Site público', url: 'https://site.test', profiles: [] },
  ],
  tests: [
    { id: 'login', title: 'Login', goal: 'Entrar', environment_id: 'web', profile_id: 'admin', access: 'authenticated', status: 'ready' },
    { id: 'landing', title: 'Landing', goal: 'Abrir', environment_id: 'site', access: 'public', status: 'ready' },
    { id: 'create-item', title: 'Criar item', goal: 'Criar', environment_id: 'web', depends_on: ['login'], status: 'ready' },
  ],
}

describe('uiTestingCatalog', () => {
  it('groups tests by environment in catalog order', () => {
    const groups = groupByEnvironment(doc, doc.tests, (test) => test.environment_id)
    expect(groups.map((group) => [group.environment.id, group.items.map((test) => test.id)])).toEqual([['web', ['login', 'create-item']], ['site', ['landing']]])
  })

  it('derives the inherited profile and access of a dependent test', () => {
    const create = doc.tests[2]
    expect(dependencyOrder(doc, 'create-item').map((test) => test.id)).toEqual(['login'])
    expect(effectiveProfileId(doc, create)).toBe('admin')
    expect(effectiveAccess(create)).toBe('authenticated')
    expect(effectiveAccess(doc.tests[1])).toBe('public')
  })

  it('blocks a dependent test whose chain profile has no credentials but never a public one', () => {
    expect(configurationIssue(doc, doc.tests[2])).toContain('Admin')
    expect(configurationIssue(doc, doc.tests[1])).toBe('')
  })
})
