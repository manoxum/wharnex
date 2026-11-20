import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { setLocalePreference } from './index'
import { ComposerRequestControls } from '../../../components/chat/composer/ComposerRequestControls'
import { ChatBindingControl } from '../../../components/chat/binding/ChatBindingControl'

it('uses English labels without translating automation and transport identifiers', () => {
  setLocalePreference('en')
  const automation = vi.fn()
  const effort = vi.fn()
  const context = vi.fn()
  const reasoning = vi.fn()
  const transport = vi.fn()
  render(<ComposerRequestControls automationMode="manual" effortLevel="high" reasoningEffort="high" contextMode="partial" chatTransportMode="scraper" onAutomationMode={automation} onEffortLevel={effort} onContextMode={context} onReasoningEffort={reasoning} onChatTransportMode={transport}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Auto + Approve' }))
  expect(automation).toHaveBeenCalledWith('auto_approve')
  const contextSelect = screen.getByRole('combobox', { name: 'Context mode' })
  expect(within(contextSelect).getByRole('option', { name: 'Partial' })).toBeTruthy()
  fireEvent.change(contextSelect, { target: { value: 'full' } })
  expect(context).toHaveBeenCalledWith('full')
  const reasoningSelect = screen.getByRole('combobox', { name: 'Reasoning effort' })
  expect(within(reasoningSelect).getByRole('option', { name: 'Instant' })).toBeTruthy()
  fireEvent.change(reasoningSelect, { target: { value: 'medium' } })
  expect(reasoning).toHaveBeenCalledWith('medium')
  fireEvent.click(screen.getByRole('button', { name: 'Manual transport' }))
  expect(transport).toHaveBeenCalledWith('manual')
  expect(screen.getByRole('button', { name: 'Auto + Approve' }).title).toContain('Auto Evolution restarts require confirmation')
})

it('localizes the conversation binding state and preserves its actual URL', () => {
  setLocalePreference('en')
  render(<ChatBindingControl chatId="chat-1" linkedUrl="https://chatgpt.com/c/Guardar" onBind={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button', { name: 'ChatGPT link: linked' }))
  expect(screen.getByRole('dialog', { name: 'ChatGPT conversation link' })).toBeTruthy()
  expect(screen.getByText('Linked conversation')).toBeTruthy()
  expect(screen.getByText('https://chatgpt.com/c/Guardar')).toBeTruthy()
})
