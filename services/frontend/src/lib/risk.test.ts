import { describe, expect, it } from 'vitest'
import { riskLabel, stateLabel } from './risk'

describe('labels', () => {
  it('maps risk and state labels', () => {
    expect(riskLabel('high')).toBe('Alto')
    expect(stateLabel('verified')).toBe('Verificado')
    expect(stateLabel('workflow_pending')).toBe('Aguardando ChatGPT')
    expect(stateLabel('answered')).toBe('Respondido')
  })
})
