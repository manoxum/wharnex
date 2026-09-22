import { useEffect, useRef, useState } from 'react'
import type { Session, TerminalRunRequest } from '../types'
import { workspaceDragEndedOutside } from '../lib/workspaceSurface'
import { InteractiveTerminal, type ConnectionStatus } from './InteractiveTerminal'
import { Icon } from './Icon'

type TerminalTab = { id: number; label: string; session: Session; reconnectNonce: number; status: ConnectionStatus }

export function TerminalWorkspace({ session, height, visible, runRequest, onHeight, onError, fill = false, onDetachTerminal, onSplitTerminal }: {
  session: Session
  height: number
  visible: boolean
  runRequest?: TerminalRunRequest
  onHeight: (value: number) => void
  onError: (message: string) => void
  fill?: boolean
  onDetachTerminal?: () => void
  onSplitTerminal?: (direction: 'vertical' | 'horizontal') => void
}) {
  const nextID = useRef(2)
  const [tabs, setTabs] = useState<TerminalTab[]>([{ id: 1, label: 'Terminal 1', session, reconnectNonce: 0, status: 'connecting' }])
  const [activeID, setActiveID] = useState(1)
  const [editingID, setEditingID] = useState<number>()
  const [editingLabel, setEditingLabel] = useState('')
  const [overflowOpen, setOverflowOpen] = useState(false)
  const runTargetRef = useRef<{ requestID: number; tabID: number } | undefined>(undefined)
  const projectPathRef = useRef(session.project_path)
  useEffect(() => {
    if (projectPathRef.current === session.project_path) return
    projectPathRef.current = session.project_path
    setTabs([{ id: 1, label: 'Terminal 1', session, reconnectNonce: 0, status: 'connecting' }])
    setActiveID(1)
    setEditingID(undefined)
    setEditingLabel('')
    setOverflowOpen(false)
    nextID.current = 2
  }, [session])

  useEffect(() => {
    if (!runRequest || runTargetRef.current?.requestID === runRequest.id) return
    if (!runRequest.openNew) {
      runTargetRef.current = { requestID: runRequest.id, tabID: activeID }
      return
    }
    const id = nextID.current++
    runTargetRef.current = { requestID: runRequest.id, tabID: id }
    setTabs((items) => [...items, { id, label: runRequest.label || `Terminal ${id}`, session, reconnectNonce: 0, status: 'connecting' }])
    setActiveID(id)
  }, [activeID, runRequest, session])

  function addTerminal() {
    const id = nextID.current++
    setTabs((items) => [...items, { id, label: `Terminal ${id}`, session, reconnectNonce: 0, status: 'connecting' }])
    setActiveID(id)
  }

  function closeTerminal(id: number) {
    const index = tabs.findIndex((item) => item.id === id)
    if (index < 0) return
    const remaining = tabs.filter((item) => item.id !== id)
    if (editingID === id) setEditingID(undefined)
    if (!remaining.length) {
      const replacementID = nextID.current++
      setTabs([{ id: replacementID, label: `Terminal ${replacementID}`, session, reconnectNonce: 0, status: 'connecting' }])
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

  function reconnectActive() {
    setTabs((items) => items.map((item) => item.id === activeID ? { ...item, reconnectNonce: item.reconnectNonce + 1, status: 'connecting' } : item))
  }

  function updateStatus(id: number, status: ConnectionStatus) {
    setTabs((items) => items.map((item) => item.id === id && item.status !== status ? { ...item, status } : item))
  }

  const activeTab = tabs.find((item) => item.id === activeID)

  return <section className={`terminal-workspace ${fill ? 'terminal-workspace-fill' : ''} ${visible ? '' : 'terminal-workspace-hidden'}`} style={{ height: fill ? '100%' : height }} aria-hidden={!visible}>
    <div className="terminal-tabbar">
      <div className="terminal-tabs" role="tablist" aria-label="Instâncias do terminal">
        {tabs.map((tab) => <div className={`terminal-tab-shell ${tab.id === activeID ? 'active' : ''}`} data-renaming={editingID === tab.id ? 'true' : undefined} key={tab.id} draggable={Boolean(onDetachTerminal)} onDragEnd={(event) => { if (onDetachTerminal && workspaceDragEndedOutside(event)) onDetachTerminal() }}>
          {editingID === tab.id ? <div className="terminal-tab-edit">
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
            <span className={`terminal-tab-status terminal-status-${tab.status}`} aria-hidden="true"/>
            <span className="terminal-tab-title">{tab.label}</span>
          </button>}
          <button type="button" className="terminal-tab-action terminal-tab-close" title={`Fechar ${tab.label}`} aria-label={`Fechar ${tab.label}`} onClick={() => closeTerminal(tab.id)}><Icon name="close" size={14}/></button>
        </div>)}
      </div>
      <div className="terminal-surface-actions">
        {activeTab && <span className={`terminal-active-status terminal-status-${activeTab.status}`} title={`Estado: ${statusLabel(activeTab.status)}`}><i/>{statusLabel(activeTab.status)}</span>}
        {onSplitTerminal && <div className="surface-layout-actions" role="group" aria-label="Dividir terminal"><button type="button" onClick={() => onSplitTerminal('vertical')} title="Dividir terminal verticalmente" aria-label="Dividir terminal verticalmente"><Icon name="arrow-right" size={16}/></button><button type="button" onClick={() => onSplitTerminal('horizontal')} title="Dividir terminal horizontalmente" aria-label="Dividir terminal horizontalmente"><Icon name="arrow-down" size={16}/></button></div>}
        <button type="button" className="terminal-add-tab" onClick={addTerminal} title="Nova instância de terminal" aria-label="Nova instância de terminal"><Icon name="plus" size={16}/></button>
        <div className={`terminal-overflow ${overflowOpen ? 'open' : ''}`}>
          <button type="button" className="terminal-toolbar-action" aria-expanded={overflowOpen} onClick={() => setOverflowOpen((open) => !open)} title="Mais ações do terminal" aria-label="Mais ações do terminal"><Icon name="more-horizontal" size={16}/></button>
          {overflowOpen && <div className="terminal-overflow-menu" role="menu" aria-label="Ações adicionais do terminal">
            <button type="button" role="menuitem" onClick={() => { reconnectActive(); setOverflowOpen(false) }}><Icon name="refresh" size={14}/><span>Reconectar</span></button>
            <button type="button" role="menuitem" onClick={() => { onHeight(height < 320 ? 390 : 245); setOverflowOpen(false) }}><Icon name="collapse" size={14}/><span>{height < 320 ? 'Expandir painel' : 'Reduzir painel'}</span></button>
            {onDetachTerminal && <button type="button" role="menuitem" onClick={() => { onDetachTerminal(); setOverflowOpen(false) }}><Icon name="external" size={14}/><span>Abrir em janela</span></button>}
          </div>}
        </div>
      </div>
    </div>
    <div className="terminal-instances">
      {tabs.map((tab) => <div className={`terminal-instance ${tab.id === activeID ? 'active' : ''}`} key={tab.id}>
        <InteractiveTerminal
          session={tab.session}
          height={Math.max(155, height - 30)}
          visible={visible && tab.id === activeID}
          reconnectNonce={tab.reconnectNonce}
          onStatusChange={(status) => updateStatus(tab.id, status)}
          runRequest={runRequest && runTargetRef.current?.requestID === runRequest.id && runTargetRef.current.tabID === tab.id ? { ...runRequest, command: inDirectory(runRequest.cwd, runRequest.command) } : undefined}
          onError={onError}
        />
      </div>)}
    </div>
  </section>
}

function statusLabel(status: ConnectionStatus) {
  return ({ connecting: 'a ligar…', connected: 'ligado', closed: 'encerrado', error: 'erro' })[status]
}

function inDirectory(cwd: string, command: string) {
  if (!cwd || cwd === '.') return command
  return `cd ${shellQuote(cwd)} && ${command}`
}

function shellQuote(value: string) { return `'${value.replace(/'/g, `'"'"'`)}'` }
