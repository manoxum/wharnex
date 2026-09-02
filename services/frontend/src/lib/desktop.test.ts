import { describe, expect, it } from 'vitest'
import { formatBytes } from './desktop'

describe('desktop helpers', () => {
  it('formats context bundle sizes', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
