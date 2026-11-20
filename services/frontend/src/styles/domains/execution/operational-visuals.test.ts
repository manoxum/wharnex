import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('operational surface visual hierarchy', () => {
  it('keeps execution errors and evidence in quiet IDE lists', () => {
    const errorStyles = `${readFileSync(resolve(process.cwd(), 'src/styles/domains/execution/error-history.css'), 'utf8')}\n${readFileSync(resolve(process.cwd(), 'src/styles/domains/execution/error-list.css'), 'utf8')}`
    const errorView = readFileSync(resolve(process.cwd(), 'src/components/execution/history/ExecutionErrorsDrawer.tsx'), 'utf8')
    const evidenceView = readFileSync(resolve(process.cwd(), 'src/components/project/knowledge/evidence/EvolutionEventsList.tsx'), 'utf8')
    expect(errorStyles).not.toContain('.execution-errors-summary')
    expect(errorStyles).not.toContain('.execution-errors-list')
    expect(errorView).toContain('min-h-[60px]')
    expect(errorView).toContain('text-[calc(12px*var(--ui-font-scale))]')
    expect(evidenceView).toContain('border-0 border-l border-solid border-l-whx-border-soft')
    expect(evidenceView).toContain("selected ? 'bg-whx-selection' : 'bg-transparent hover:bg-whx-hover'")
    expect(evidenceView).not.toContain('rounded-')
  })
})
