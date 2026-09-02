import { describe, expect, it } from 'vitest'
import { riskLabel, stateLabel } from './risk'

describe('labels', () => {
  it('maps risk and state labels', () => {
    expect(riskLabel('high')).toBe('Alto')
    expect(stateLabel('verified')).toBe('Verificado')
  })
})
