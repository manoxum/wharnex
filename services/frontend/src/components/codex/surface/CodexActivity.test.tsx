import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CodexActivity } from './CodexActivity'
afterEach(cleanup)
it('shows progress summaries, strategy, commands, results and changed files', () => {
  render(<CodexActivity items={[
    { id: 's', type: 'reasoning', summary: ['A investigar a regressão.'] },
    { id: 'p', type: 'plan', explanation: 'Corrigir e verificar.', plan: [{ step: 'Testar a correção', status: 'inProgress' }] },
    { id: 'c', type: 'commandExecution', command: 'npm test', aggregatedOutput: '5 passed', status: 'completed', exitCode: 0 },
    { id: 'f', type: 'fileChange', changes: [{ path: 'src/retry.ts', kind: { type: 'update' }, diff: '+ fixed' }] },
    { id: 'a', type: 'approvalReview', status: 'approved', explanation: 'A alteração está limitada ao projeto.', riskLevel: 'low' },
  ]}/>)
  expect(screen.getByText('A investigar a regressão.')).toBeTruthy()
  expect(screen.getByText(/Testar a correção/)).toBeTruthy()
  expect(screen.getByText('npm test')).toBeTruthy()
  fireEvent.click(screen.getByText('Resultado'))
  expect(screen.getByText('5 passed')).toBeTruthy()
  expect(screen.getByText(/src\/retry.ts/)).toBeTruthy()
  expect(screen.getByText('Decisão de aprovação')).toBeTruthy(); expect(screen.getByText('Aprovado')).toBeTruthy()
  expect(screen.getByText('A alteração está limitada ao projeto.')).toBeTruthy()
})
