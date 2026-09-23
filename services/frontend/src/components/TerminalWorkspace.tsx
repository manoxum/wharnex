import { useEffect, useRef, useState } from 'react'
import type { Session, TerminalRunRequest } from '../types'
import { workspaceDragEndedOutside } from '../lib/workspaceSurface'
import { InteractiveTerminal, type ConnectionStatus } from './InteractiveTerminal'
import { Icon } from './Icon'

type TerminalTab = { id: number; label: string; session: Session; reconnectNonce: number; status: ConnectionStatus; cwd: string; history: string; viewportY: number }
type PersistedTerminalTab = Pick<TerminalTab, 'id' | 'label' | 'cwd' | 'history' | 'viewportY'>

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
  const initialMemory = useRef(loadTerminalWorkspace(session.project_path))
  const nextID = useRef(Math.max(2, initialMemory.current.nextID))
  const [tabs, setTabs] = useState<TerminalTab[]>(() => terminalTabsFromMemory(session, initialMemory.current.tabs))
  const [activeID, setActiveID] = useState(() => initialMemory.current.tabs.some((tab) => tab.id === initialMemory.current.activeID) ? initialMemory.current.activeID : terminalTabsFromMemory(session, initialMemory.current.tabs)[0].id)
  const [editingID, setEditingID] = useState<number>()
  const [editingLabel, setEditingLabel] = useState('')
  const [overflowOpen, setOverflowOpen] = useState(false)
  const runTargetRef = useRef<{ requestID: number; tabID: number } | undefined>(undefined)
  const projectPathRef = useRef(session.project_path)
  useEffect(() => {
    if (projectPathRef.current === session.project_path) return
    projectPathRef.current = session.project_path
    const memory = loadTerminalWorkspace(session.project_path)
    const restored = terminalTabsFromMemory(session, memory.tabs)
    setTabs(restored)
    setActiveID(restored.some((tab) => tab.id === memory.activeID) ? memory.activeID : restored[0].id)
    setEditingID(undefined)
    setEditingLabel('')
    setOverflowOpen(false)
    nextID.current = Math.max(memory.nextID, ...restored.map((tab) => tab.id + 1))
  }, [session])

  useEffect(() => {
    saveTerminalWorkspace(session.project_path, { activeID, nextID: nextID.current, tabs })
  }, [activeID, session.project_path, tabs])

  useEffect(() => {
    if (!runRequest || runTargetRef.current?.requestID === runRequest.id) return
    if (!runRequest.openNew) {
      runTargetRef.current = { requestID: runRequest.id, tabID: activeID }
      if (runRequest.cwd) setTabs((items) => items.map((item) => item.id === activeID ? { ...item, cwd: runRequest.cwd } : item))
      return
    }
    const id = nextID.current++
    runTargetRef.current = { requestID: runRequest.id, tabID: id }
    setTabs((items) => [...items, { id, label: runRequest.label || `Terminal ${id}`, session, reconnectNonce: 0, status: 'connecting', cwd: runRequest.cwd || '.', history: '', viewportY: 0 }])
    setActiveID(id)
  }, [activeID, runRequest, session])

  function addTerminal() {
    const id = nextID.current++
    setTabs((items) => [...items, { id, label: `Terminal ${id}`, session, reconnectNonce: 0, status: 'connecting', cwd: '.', history: '', viewportY: 0 }])
    setActiveID(id)
  }

  function closeTerminal(id: number) {
    const index = tabs.findIndex((item) => item.id === id)
    if (index < 0) return
    const remaining = tabs.filter((item) => item.id !== id)
    if (editingID === id) setEditingID(undefined)
    if (!remaining.length) {
      const replacementID = nextID.current++
      setTabs([{ id: replacementID, label: `Terminal ${replacementID}`, session, reconnectNonce: 0, status: 'connecting', cwd: '.', history: '', viewportY: 0 }])
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

  function updateSnapshot(id: number, snapshot: { cwd: string; history: string; viewportY: number }) {
    setTabs((items) => items.map((item) => item.id === id ? { ...item, ...snapshot } : item))
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
          {overflowOpen && <div className="terminal-overflow-menu" role="menu" aria-label="Ações adicionais do terminal" data-chatgpt-overlay-blocker="true">
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
          cwd={tab.cwd}
          initialHistory={tab.history}
          initialViewportY={tab.viewportY}
          onSnapshot={(snapshot) => updateSnapshot(tab.id, snapshot)}
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


const TERMINAL_WORKSPACE_PREFIX = 'whx.terminal.workspace.v1:'
const MAX_PERSISTED_TERMINAL_HISTORY = 256 * 1024

function terminalWorkspaceKey(projectPath: string) { return `${TERMINAL_WORKSPACE_PREFIX}${projectPath}` }

function loadTerminalWorkspace(projectPath: string): { activeID: number; nextID: number; tabs: PersistedTerminalTab[] } {
  try {
    const parsed = JSON.parse(localStorage.getItem(terminalWorkspaceKey(projectPath)) || '{}')
    const tabs = Array.isArray(parsed?.tabs) ? parsed.tabs.slice(0, 12).flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return []
      const tab = value as Record<string, unknown>
      const id = Number(tab.id)
      if (!Number.isInteger(id) || id <= 0) return []
      return [{ id, label: String(tab.label || `Terminal ${id}`).slice(0, 120), cwd: String(tab.cwd || '.').slice(0, 4096), history: String(tab.history || '').slice(-MAX_PERSISTED_TERMINAL_HISTORY), viewportY: Math.max(0, Math.floor(Number(tab.viewportY) || 0)) }]
    }) : []
    return { activeID: Number(parsed?.activeID) || tabs[0]?.id || 1, nextID: Math.max(Number(parsed?.nextID) || 2, ...tabs.map((tab: PersistedTerminalTab) => tab.id + 1)), tabs }
  } catch { return { activeID: 1, nextID: 2, tabs: [] } }
}

function terminalTabsFromMemory(session: Session, tabs: PersistedTerminalTab[]): TerminalTab[] {
  const restored = tabs.map((tab) => ({ ...tab, session, reconnectNonce: 0, status: 'connecting' as ConnectionStatus }))
  return restored.length ? restored : [{ id: 1, label: 'Terminal 1', session, reconnectNonce: 0, status: 'connecting', cwd: '.', history: '', viewportY: 0 }]
}

function saveTerminalWorkspace(projectPath: string, value: { activeID: number; nextID: number; tabs: TerminalTab[] }) {
  try {
    const tabs = value.tabs.slice(0, 12).map(({ id, label, cwd, history, viewportY }) => ({ id, label, cwd, history: history.slice(-MAX_PERSISTED_TERMINAL_HISTORY), viewportY }))
    localStorage.setItem(terminalWorkspaceKey(projectPath), JSON.stringify({ version: 1, activeID: value.activeID, nextID: value.nextID, tabs }))
  } catch { /* storage quota is best-effort */ }
}
