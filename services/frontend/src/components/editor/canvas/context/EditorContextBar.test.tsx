import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorRunOption } from '../../../../lib/editor/runtime/editorExecution'
import { EditorContextBar } from './EditorContextBar'

const recentRun: EditorRunOption = {
  id: 'script:test', label: 'Script · test', command: "npm run 'test'", cwd: '.', line: 8,
}

afterEach(() => { vi.restoreAllMocks() })

function renderContextBar(onRun = vi.fn()) {
  return render(<EditorContextBar path="package.json" projectPath="/workspace/demo" gitDiffDisabled gitDiffLoading={false}
    recentRunOptions={[recentRun]} showPreviewToggle={false} previewing={false} onShowGitDiff={() => undefined}
    onRun={onRun} onTogglePreview={() => undefined}/>)
}

describe('EditorContextBar recent runs', () => {
  it('runs the selected command and closes the menu', () => {
    const onRun = vi.fn()
    renderContextBar(onRun)
    fireEvent.click(screen.getByRole('button', { name: 'Execuções recentes' }))
    fireEvent.click(screen.getByRole('button', { name: /Script · test/ }))
    expect(onRun).toHaveBeenCalledWith('script:test')
    expect(screen.queryByRole('dialog', { name: 'Execuções recentes' })).toBeNull()
  })

  it('closes on outside press and Escape while preserving command visibility', () => {
    renderContextBar()
    const trigger = screen.getByRole('button', { name: 'Execuções recentes' })
    fireEvent.click(trigger)
    expect(screen.getByText("npm run 'test'")).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
