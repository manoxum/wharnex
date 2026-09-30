import { describe, expect, it } from 'vitest'
import { bytesToMiB, miBToBytes, parsePatternLines } from './projectConfig'

describe('project context config helpers', () => {
  it('normalizes pattern lines', () => {
    expect(parsePatternLines('src/**\n\n# note\nsrc/**\ndocs/*.md')).toEqual(['src/**', 'docs/*.md'])
  })
  it('converts bounded MiB values', () => {
    expect(bytesToMiB(4 * 1024 * 1024)).toBe(4)
    expect(miBToBytes(100)).toBe(64 * 1024 * 1024)
  })
})
