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
  const runTargetRef = useRef<{ requestID: number; tabID: number } | undefined>(undefined)
  if (runRequest && runTargetRef.current?.requestID !== runRequest.id) runTargetRef.current = { requestID: runRequest.id, tabID: activeID }

  useEffect(() => {
    setTabs([{ id: 1, label: 'Terminal 1' }])
    setActiveID(1)
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
    if (!remaining.length) {
      const replacementID = nextID.current++
      setTabs([{ id: replacementID, label: `Terminal ${replacementID}` }])
      setActiveID(replacementID)
      return
    }
    setTabs(remaining)
    if (activeID === id) setActiveID(remaining[Math.min(index, remaining.length - 1)].id)
  }

  return <section className={`terminal-workspace ${visible ? '' : 'terminal-workspace-hidden'}`} style={{ height }} aria-hidden={!visible}>
    <div className="terminal-tabbar">
      <div className="terminal-tabs" role="tablist" aria-label="Instâncias do terminal">
        {tabs.map((tab) => <button type="button" role="tab" aria-selected={tab.id === activeID} className={tab.id === activeID ? 'active' : ''} key={tab.id} onClick={() => setActiveID(tab.id)}>
          <Icon name="terminal" size={11}/><span>{tab.label}</span>
          <i title={`Fechar ${tab.label}`} aria-label={`Fechar ${tab.label}`} onClick={(event) => { event.stopPropagation(); closeTerminal(tab.id) }}>×</i>
        </button>)}
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
