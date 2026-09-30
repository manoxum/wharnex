import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { InternalWindow } from '../../../components/workspace/window/InternalWindow'
import { INTERNAL_WINDOW_DOCK_ID } from './internalWindow'
import { InternalWindowPersistenceContext, usePersistentInternalWindowOwners } from './internalWindowPersistence'

const OWNERS = ['archive', 'project'] as const

afterEach(() => document.getElementById(INTERNAL_WINDOW_DOCK_ID)?.remove())

function PersistenceHarness() {
  const [active, setActive] = useState<(typeof OWNERS)[number]>('archive')
  const [open, setOpen] = useState(true)
  const persistence = usePersistentInternalWindowOwners('project\nleft', OWNERS, active)

  return <>
    <button type="button" onClick={() => setActive('archive')}>Chats</button>
    <button type="button" onClick={() => setActive('project')}>Projeto</button>
    {persistence.mountedOwners.map((owner) => <div key={owner} data-owner={owner} style={owner === active ? undefined : { display: 'none' }}>
      <InternalWindowPersistenceContext.Provider value={{ owner: persistence.ownerFor(owner), register: persistence.register }}>
        {owner === 'archive' && open ? <InternalWindow title="Pré-visualização" onClose={() => setOpen(false)}>
          <section role="dialog" aria-modal="false" aria-label="Pré-visualização"><input aria-label="Rascunho" defaultValue="inicial"/></section>
        </InternalWindow> : null}
        {owner === 'project' ? <span>Explorador</span> : null}
      </InternalWindowPersistenceContext.Provider>
    </div>)}
  </>
}

describe('internal window persistence owners', () => {
  it('keeps open and minimized windows alive across owner switches', () => {
    render(<PersistenceHarness/>)
    const draft = screen.getByRole('textbox', { name: 'Rascunho' }) as HTMLInputElement
    fireEvent.change(draft, { target: { value: 'preservado' } })

    fireEvent.click(screen.getByRole('button', { name: 'Projeto' }))
    expect(screen.getByRole('dialog', { name: 'Pré-visualização' })).toBeTruthy()
    expect(document.querySelector('[data-owner="archive"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Minimizar Pré-visualização' }))
    expect(screen.queryByRole('dialog', { name: 'Pré-visualização' })).toBeNull()
    expect(screen.getByTitle('Restaurar Pré-visualização')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Chats' }))
    fireEvent.click(screen.getByTitle('Restaurar Pré-visualização'))
    expect((screen.getByRole('textbox', { name: 'Rascunho' }) as HTMLInputElement).value).toBe('preservado')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Pré-visualização' }))
    fireEvent.click(screen.getByRole('button', { name: 'Projeto' }))
    expect(document.querySelector('[data-owner="archive"]')).toBeNull()
  })
})
