import { describe, expect, it } from 'vitest'
import { errorMessage } from './errorMessage'

describe('errorMessage', () => {
  it('removes Electron IPC implementation noise from a user-facing error', () => {
    expect(errorMessage(new Error("Error invoking remote method 'wharness:chatgpt:retry-prepared-prompt': Error: Não existe uma entrega recente"))).toBe('Não existe uma entrega recente')
  })

  it('preserves ordinary errors and uses the supplied fallback', () => {
    expect(errorMessage(new Error('Falha local'))).toBe('Falha local')
    expect(errorMessage(undefined, 'Indisponível')).toBe('Indisponível')
  })
})
