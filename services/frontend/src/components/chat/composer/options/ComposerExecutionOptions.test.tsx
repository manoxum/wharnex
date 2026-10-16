import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ComposerRequestControls } from '../ComposerRequestControls'

describe('progressive composer configuration', () => {
  it('keeps context and intelligence visible while preserving every execution option behind a named control', () => {
    const automation = vi.fn(), effort = vi.fn(), transport = vi.fn()
    render(<ComposerRequestControls progressive automationMode="auto" effortLevel="ultra" reasoningEffort="medium" contextMode="partial" chatTransportMode="scraper" onAutomationMode={automation} onEffortLevel={effort} onChatTransportMode={transport}/>)
    expect(screen.getByRole('combobox', { name: 'Modalidade de contexto' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Esforço de raciocínio' })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Nível de esforço' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Execução e transporte' }))
    const panel = screen.getByRole('dialog', { name: 'Execução e transporte' })
    const budget = within(panel).getByRole('combobox', { name: 'Nível de esforço' }) as HTMLSelectElement
    expect(budget.value).toBe('ultra')
    expect(Array.from(budget.options).map((option) => option.value)).toEqual(['low', 'medium', 'high', 'extra_high', 'max', 'ultra', 'loop'])
    fireEvent.change(budget, { target: { value: 'loop' } })
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Automação de execução' }), { target: { value: 'manual' } })
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Transporte com o ChatGPT' }), { target: { value: 'manual' } })
    expect(effort).toHaveBeenCalledWith('loop')
    expect(automation).toHaveBeenCalledWith('manual')
    expect(transport).toHaveBeenCalledWith('manual')
  })
  it('keeps busy controls disabled and never changes a permission by opening settings', () => {
    const change = vi.fn()
    render(<ComposerRequestControls progressive busy automationMode="auto_approve" effortLevel="high" reasoningEffort="high" contextMode="full" chatTransportMode="scraper" onAutomationMode={change}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Execução e transporte' }))
    for (const select of within(screen.getByRole('dialog')).getAllByRole('combobox')) expect((select as HTMLSelectElement).disabled).toBe(true)
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByText(/O reinício de auto-evolução/)).toBeTruthy()
  })
})
