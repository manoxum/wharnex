import { describe, expect, it } from 'vitest'
import source from './DirectChatGPTPane.tsx?raw'

describe('DirectChatGPTPane isolation', () => {
  it('provides navigation without registering WHX automation listeners', () => {
    expect(source).toMatch(/ChatGPT livre/)
    expect(source).toMatch(/\.chatgpt\.show/)
    expect(source).toMatch(/\.chatgpt\.reload/)
    expect(source).not.toMatch(/onBundleDownloaded/)
    expect(source).not.toMatch(/onActivity/)
    expect(source).not.toMatch(/onHumanAction/)
    expect(source).not.toMatch(/preparePrompt|submitPrompt|armBundleDownload/)
  })
})
