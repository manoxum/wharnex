import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

describe('composer layout CSS', () => {
  it('keeps the send button flush to the far-right edge without removing hint spacing', () => {
    expect(css).toContain('.composer-footer { flex: 0 0 auto; margin-top: 0; padding: 6px 0 9px 9px;')
    expect(css).toContain('.composer-toolbar-row .send-button { justify-self: end; margin-left: auto; margin-right: 0; }')
    expect(css).toContain('.composer-hint { padding-right: 6px; }')
  })
})
