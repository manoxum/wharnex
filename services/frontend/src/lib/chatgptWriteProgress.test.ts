import { describe, expect, it } from 'vitest'
import { chatgptWriteInProgressNotice } from './chatgptWriteProgress'

describe('ChatGPT write progress notice', () => {
  it('does not claim the bundle is still being prepared during an in-progress write', () => {
    expect(chatgptWriteInProgressNotice).toContain('envio do pedido')
    expect(chatgptWriteInProgressNotice).not.toContain('bundle ainda')
  })
})
