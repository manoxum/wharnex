import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExternalAgentsPanel } from './ExternalAgentsPanel'

afterEach(cleanup)

describe('ExternalAgentsPanel', () => {
  it('sends a prompt to the selected agent in the current project terminal', () => {
    const onRunInTerminal = vi.fn()
    render(<ExternalAgentsPanel projectPath="/workspace/project" onRunInTerminal={onRunInTerminal}/>)

    fireEvent.click(screen.getByRole('radio', { name: /Claude Code/ }))
    fireEvent.change(screen.getByLabelText('Prompt para Claude Code'), { target: { value: "Review John's parser" } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para Claude Code' }))

    expect(onRunInTerminal).toHaveBeenCalledWith({ command: `claude 'Review John'"'"'s parser'`, cwd: '/workspace/project', label: 'Agentes IA · Claude Code' })
  })

  it('manages the official VS Code extensions from the same panel', () => {
    const onRunInTerminal = vi.fn()
    render(<ExternalAgentsPanel projectPath="/workspace/project" onRunInTerminal={onRunInTerminal}/>)

    expect(screen.getByText('openai.chatgpt')).toBeTruthy()
    expect(screen.getByText('anthropic.claude-code')).toBeTruthy()
    expect(screen.getByText('saoudrizwan.claude-dev')).toBeTruthy()

    const updateButtons = screen.getAllByRole('button', { name: 'Atualizar' })
    fireEvent.click(updateButtons[2])
    expect(onRunInTerminal).toHaveBeenLastCalledWith({ command: 'code --install-extension saoudrizwan.claude-dev --force', cwd: '/workspace/project', label: 'Agentes IA · Plugin Cline' })

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar todos' }))
    expect(onRunInTerminal.mock.calls.at(-1)?.[0].command).toContain('code --install-extension openai.chatgpt --force')
    expect(onRunInTerminal.mock.calls.at(-1)?.[0].command).toContain('code --install-extension anthropic.claude-code --force')
  })

  it('disables executable actions when the integrated terminal bridge is unavailable', () => {
    render(<ExternalAgentsPanel projectPath="/workspace/project"/>)
    fireEvent.change(screen.getByLabelText('Prompt para Codex'), { target: { value: 'Refactor module' } })
    expect(screen.getByRole('button', { name: 'Enviar para Codex' }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByText(/terminal integrado não está disponível/i)).toBeTruthy()
  })
})
