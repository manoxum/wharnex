import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexEngineControl } from './CodexEngineControl'

vi.mock('../../../lib/desktop/bridge/desktop', () => ({ desktopBridge: () => ({ codex: {} }) }))
vi.mock('../../../lib/codex', () => ({ useCodexStatus: () => ({ data: { models: [{ id: 'model-id', model: 'official-model', label: 'Official Model' }] } }) }))
afterEach(cleanup)
describe('composer engine selector', () => {
  it('switches between ChatGPT Scraper and Codex through an accessible control', () => {
    const onEngine = vi.fn()
    render(<CodexEngineControl projectPath="/project" onEngine={onEngine}/>)
    expect(screen.getByText('ChatGPT Scraper')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Engine Codex' }))
    expect(onEngine).toHaveBeenCalledWith('codex')
  })
  it('blocks changes during an active request', () => {
    const onEngine = vi.fn()
    render(<CodexEngineControl projectPath="/project" engine="codex" onEngine={onEngine} disabled/>)
    fireEvent.click(screen.getByRole('switch'))
    expect(onEngine).not.toHaveBeenCalled()
  })
  it('uses the runtime model catalog rather than hardcoded model names', () => {
    const onCodexModel = vi.fn()
    render(<CodexEngineControl projectPath="/project" engine="codex" onCodexModel={onCodexModel}/>)
    fireEvent.change(screen.getByRole('combobox', { name: 'Modelo Codex' }), { target: { value: 'official-model' } })
    expect(onCodexModel).toHaveBeenCalledWith('official-model')
  })
})
