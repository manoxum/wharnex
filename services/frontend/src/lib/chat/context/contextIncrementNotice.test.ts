import { describe, expect, it } from 'vitest'
import { contextIncrementMeta, contextIncrementNotice } from './contextIncrementNotice'

describe('context increment notices', () => {
  it('names the round without implying a round ceiling', () => {
    const notice = contextIncrementNotice(8)
    expect(notice).toContain('ronda 8')
    expect(notice).not.toMatch(/\d+\/\d+/)
  })

  it('reports the cumulative selected files', () => {
    expect(contextIncrementMeta(2, 1)).toBe('Contexto Parcial · ronda 2 · 1 ficheiro')
    expect(contextIncrementMeta(7, 12)).toBe('Contexto Parcial · ronda 7 · 12 ficheiros')
  })
})
