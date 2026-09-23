import { describe, expect, it } from 'vitest'
import { pairingCodeFromScan } from './pairing'

describe('pairingCodeFromScan', () => {
  it('accepts a same-origin pairing QR', () => {
    expect(pairingCodeFromScan('https://remote.example/?pair=abc_12345', 'https://remote.example')).toBe('abc_12345')
  })
  it('rejects a pairing QR from another origin', () => {
    expect(pairingCodeFromScan('https://evil.example/?pair=abc_12345', 'https://remote.example')).toBe('')
  })
})
