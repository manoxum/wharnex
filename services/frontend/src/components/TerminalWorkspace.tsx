import { useEffect, useRef, useState } from 'react'
import type { Session, TerminalRunRequest } from '../types'
import { InteractiveTerminal } from './InteractiveTerminal'
import { Icon } from './Icon'

type TerminalTab = { id: number; label: string }

export function TerminalWorkspace({ session, height, visible, runRequest, onHeight, onError }: {
  session: Session
  height: number
  visible: boolean
  runRequest?: TerminalRunRequest
  onHeight: (value: number) => void
  onError: (message: string) => void
}) {
  const nextID = useRef(2)
  const [tabs, setTabs] = useState<TerminalTab[]>([{ id: 1, label: 'Terminal 1' }])
  const [activeID, setActiveID] = useState(1)
  const [editingID, setEditingID] = useState<number>()
  const [editingLabel, setEditingLabel] = useState('')
  const runTargetRef = useRef<{ requestID: number; tabID: number } | undefined>(undefined)
  if (runRequest && runTargetRef.current?.requestID !== runRequest.id) runTargetRef.current = { requestID: runRequest.id, tabID: activeID }

  useEffect(() => {
    setTabs([{ id: 1, label: 'Terminal 1' }])
    setActiveID(1)
    setEditingID(undefined)
    setEditingLabel('')
    nextID.current = 2
  }, [session.id])

  function addTerminal() {
    const id = nextID.current++
    setTabs((items) => [...items, { id, label: `Terminal ${id}` }])
    setActiveID(id)
  }

  function closeTerminal(id: number) {
    const index = tabs.findIndex((item) => item.id === id)
    if (index < 0) return
    const remaining = tabs.filter((item) => item.id !== id)
    if (editingID === id) setEditingID(undefined)
    if (!remaining.length) {
      const replacementID = nextID.current++
      setTabs([{ id: replacementID, label: `Terminal ${replacementID}` }])
      setActiveID(replacementID)
      return
    }
    setTabs(remaining)
    if (activeID === id) setActiveID(remaining[Math.min(index, remaining.length - 1)].id)
  }

  function beginRename(tab: TerminalTab) {
    setActiveID(tab.id)
    setEditingID(tab.id)
    setEditingLabel(tab.label)
  }

  function finishRename(id: number) {
    const label = editingLabel.trim()
    if (label) setTabs((items) => items.map((item) => item.id === id ? { ...item, label } : item))
    setEditingID(undefined)
    setEditingLabel('')
  }

  return <section className={`terminal-workspace ${visible ? '' : 'terminal-workspace-hidden'}`} style={{ height }} aria-hidden={!visible}>
    <div className="terminal-tabbar">
      <div className="terminal-tabs" role="tablist" aria-label="Instâncias do terminal">
        {tabs.map((tab) => <div className={`terminal-tab-shell ${tab.id === activeID ? 'active' : ''}`} key={tab.id}>
          {editingID === tab.id ? <div className="terminal-tab-edit">
            <Icon name="terminal" size={11}/>
            <input
              autoFocus
              aria-label={`Renomear ${tab.label}`}
              value={editingLabel}
              onChange={(event) => setEditingLabel(event.target.value)}
              onBlur={() => finishRename(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); finishRename(tab.id) }
                if (event.key === 'Escape') { event.preventDefault(); setEditingID(undefined); setEditingLabel('') }
              }}
            />
          </div> : <button
            type="button"
            role="tab"
            aria-selected={tab.id === activeID}
            className="terminal-tab-select"
            onClick={() => setActiveID(tab.id)}
            onDoubleClick={() => beginRename(tab)}
            title={`${tab.label} · duplo clique para renomear`}
          >
            <Icon name="terminal" size={11}/><span>{tab.label}</span>
          </button>}
          {editingID !== tab.id && <button type="button" className="terminal-tab-action terminal-tab-rename" title={`Renomear ${tab.label}`} aria-label={`Renomear ${tab.label}`} onClick={() => beginRename(tab)}><Icon name="rename" size={10}/></button>}
          <button type="button" className="terminal-tab-action terminal-tab-close" title={`Fechar ${tab.label}`} aria-label={`Fechar ${tab.label}`} onClick={() => closeTerminal(tab.id)}>×</button>
        </div>)}
      </div>
      <button type="button" className="terminal-add-tab" onClick={addTerminal} title="Nova instância de terminal" aria-label="Nova instância de terminal"><Icon name="plus" size={12}/></button>
    </div>
    <div className="terminal-instances">
      {tabs.map((tab) => <div className={`terminal-instance ${tab.id === activeID ? 'active' : ''}`} key={tab.id}>
        <InteractiveTerminal
          session={session}
          height={Math.max(155, height - 30)}
          visible={visible && tab.id === activeID}
          runRequest={runRequest && runTargetRef.current?.requestID === runRequest.id && runTargetRef.current.tabID === tab.id ? { ...runRequest, command: inDirectory(runRequest.cwd, runRequest.command) } : undefined}
          onHeight={(value) => onHeight(value + 30)}
          onError={onError}
        />
      </div>)}
    </div>
  </section>
}

function inDirectory(cwd: string, command: string) {
  if (!cwd || cwd === '.') return command
  return `cd ${shellQuote(cwd)} && ${command}`
}

function shellQuote(value: string) { return `'${value.replace(/'/g, `'"'"'`)}'` }
