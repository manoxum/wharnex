import { describe, expect, it } from 'vitest'
import { promptDeliveryFailureKind } from './chatgptPromptDelivery'

describe('prompt delivery failure classification', () => {
  it('does not offer a delivery retry when the visible ChatGPT page has no usable composer', () => {
    expect(promptDeliveryFailureKind('ChatGPT composer DOM was not found')).toBe('attention')
  })

  it('keeps a retry available for a confirmed upload transport failure', () => {
    expect(promptDeliveryFailureKind('ChatGPT upload failed after 5 attempts: network error')).toBe('retry')
  })
})
