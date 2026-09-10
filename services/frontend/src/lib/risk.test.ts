import { describe, expect, it } from 'vitest'
import { riskLabel, stateLabel } from './risk'

describe('labels', () => {
  it('maps risk and state labels', () => {
    expect(riskLabel('high')).toBe('Alto')
    expect(stateLabel('verified')).toBe('Verificado')
    expect(stateLabel('workflow_pending')).toBe('Aguardando ChatGPT')
    expect(stateLabel('answered')).toBe('Respondido')
    expect(stateLabel('baseline_update_pending')).toBe('A adaptar ao novo baseline')
    expect(stateLabel('awaiting_plan_approval')).toBe('Plano aguarda aprovação')
    expect(stateLabel('plan_rejected')).toBe('Plano rejeitado')
  })
})
