import { beforeEach, describe, expect, it } from 'vitest'
import { loadBoundActiveProject, loadBoundProjects, saveBoundActiveProject, saveBoundProjects } from './projectBindings'

beforeEach(() => localStorage.clear())

describe('desktop project bindings', () => {
  it('persists a bounded deduplicated project list for the current window scope', () => {
    saveBoundProjects(['/tmp/a', '/tmp/b', '/tmp/a'])
    expect(loadBoundProjects()).toEqual(['/tmp/a', '/tmp/b'])
  })

  it('persists the active bound project independently from the list', () => {
    saveBoundProjects(['/tmp/a', '/tmp/b'])
    saveBoundActiveProject('/tmp/b')
    expect(loadBoundActiveProject()).toBe('/tmp/b')
    saveBoundActiveProject('')
    expect(loadBoundActiveProject()).toBe('')
  })
})
