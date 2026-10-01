import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GitContributorsOverview } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { GitContributorsSection } from './GitContributorsSection'

vi.mock('../../../lib/transport/http/api', () => ({ api: { gitContributors: vi.fn() } }))

describe('GitContributorsSection', () => {
  it('renders repository contribution geometry as a skeleton while loading', () => {
    vi.mocked(api.gitContributors).mockReturnValue(new Promise<GitContributorsOverview>(() => { /* keep the request pending */ }))

    const { container } = render(<GitContributorsSection sessionId="ses_1" repository="" repositoryLabel="Principal"/>)

    const loading = screen.getByLabelText('A calcular contribuições do repositório: Principal')
    expect(loading.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelectorAll('.git-contributor-summary > div')).toHaveLength(3)
    expect(container.querySelectorAll('.git-contribution-calendar-card')).toHaveLength(1)
    expect(container.querySelectorAll('.git-contribution-chart-card')).toHaveLength(1)
    expect(container.querySelectorAll('.git-contributor-card')).toHaveLength(2)
    expect(container.querySelectorAll('.skeleton-line').length).toBeGreaterThan(10)
    expect(container.querySelectorAll('.skeleton-block').length).toBeGreaterThan(5)
    expect(screen.queryByText('A calcular contribuições do repositório…')).toBeNull()
  })
})
