import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerSessionControls } from '../ComposerSessionControls'

const bridge = vi.hoisted(() => ({ getChatGPTModels: vi.fn(), setChatGPTModel: vi.fn() }))
vi.mock('../../../../lib/desktop/bridge/desktop', () => ({ desktopBridge: () => ({ chatgpt: bridge }) }))
const session = { automation_mode: 'manual', effort_level: 'ultra', reasoning_effort: 'medium', context_mode: 'partial', chat_transport_mode: 'scraper' } as const

describe('session composer control ownership', () => {
  afterEach(cleanup)

  it('preserves session modes separately from explicit overrides', () => {
    const onReasoningEffort = vi.fn()
    render(<ComposerSessionControls session={session} workspaceChatId="chat-a" requestActive={false} contextMode="full" onReasoningEffort={onReasoningEffort} />)
    expect((screen.getByRole('combobox', { name: 'Modalidade de contexto' }) as HTMLSelectElement).value).toBe('full')
    expect((screen.getByRole('combobox', { name: 'Nível de esforço' }) as HTMLSelectElement).value).toBe('ultra')
    expect((screen.getByRole('combobox', { name: 'Esforço de raciocínio' }) as HTMLSelectElement).value).toBe('medium')
    fireEvent.change(screen.getByRole('combobox', { name: 'Esforço de raciocínio' }), { target: { value: 'instant' } })
    expect(onReasoningEffort).toHaveBeenCalledWith('instant')
  })

  it.each([
    { requestActive: true, busy: false, chatTransportMode: 'scraper' as const },
    { requestActive: false, busy: true, chatTransportMode: 'scraper' as const },
    { requestActive: false, busy: false, chatTransportMode: 'manual' as const },
  ])('blocks model discovery for active, busy or manual transport: %j', (state) => {
    render(<ComposerSessionControls session={session} workspaceChatId="chat-a" {...state} />)
    expect((screen.getByRole('button', { name: 'Modelo do ChatGPT' }) as HTMLButtonElement).disabled).toBe(true)
    expect(bridge.getChatGPTModels).not.toHaveBeenCalled()
  })
})
