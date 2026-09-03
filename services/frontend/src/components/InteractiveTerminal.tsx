import { useEffect, useState } from 'react'
import { api, APIError } from '../lib/api'
import { parseArgv } from '../lib/shell'
import type { CommandResult, Session, TerminalTarget } from '../types'
import { Icon } from './Icon'

type TerminalEntry = { id: string; command: string; cwd: string; target: TerminalTarget; result?: CommandResult; error?: string }

export function InteractiveTerminal({ session, height, onHeight, onError }: { session: Session; height: number; onHeight: (value: number) => void; onError: (message: string) => void }) {
  const [input, setInput] = useState('')
  const [target, setTarget] = useState<TerminalTarget>('sandbox')
  const [hostConfirmed, setHostConfirmed] = useState(false)
  const [cwdByTarget, setCwdByTarget] = useState<Record<TerminalTarget, string>>({ sandbox: '.', host: '.' })
  const [network, setNetwork] = useState(false)
  const [running, setRunning] = useState(false)
  const [entries, setEntries] = useState<TerminalEntry[]>([])
  const cwd = cwdByTarget[target]

  useEffect(() => {
    setInput('')
    setTarget('sandbox')
    setHostConfirmed(false)
    setCwdByTarget({ sandbox: '.', host: '.' })
    setNetwork(false)
    setRunning(false)
    setEntries([])
  }, [session.id])

  function selectTarget(next: TerminalTarget) {
    if (next === target) return
    if (next === 'host') {
      const accepted = window.confirm('Ativar Terminal HOST?\n\nOs comandos serão executados diretamente no projeto real, sem sandbox. O Policy Engine continua ativo e comandos perigosos continuam bloqueados. Alterações podem ser imediatas e não têm rollback automático.')
      if (!accepted) return
      setHostConfirmed(true)
      setNetwork(false)
    }
    if (next === 'sandbox') setHostConfirmed(false)
    setTarget(next)
  }

  async function execute() {
    const raw = input.trim(); if (!raw || running) return
    setInput('')
    if (raw === 'clear') { setEntries([]); return }
    let argv: string[]
    try { argv = parseArgv(raw) } catch (error) { onError(messageOf(error)); return }
    if (!argv.length) return
    if (argv[0] === 'cd') {
      const next = normalizeCwd(cwd, argv[1] || '.')
      setCwdByTarget((value) => ({ ...value, [target]: next }))
      setEntries((items) => [...items, { id: crypto.randomUUID(), command: raw, cwd, target, result: { argv, cwd, exit_code: 0, stdout: '', stderr: '', duration_ms: 0, success: true } }]); return
    }
    const id = crypto.randomUUID(); setEntries((items) => [...items, { id, command: raw, cwd, target }]); setRunning(true)
    try {
      const result = await api.terminal(session.id, { argv, cwd, network: target === 'sandbox' ? network : false, timeout_seconds: 300, expected_exit_codes: [0] }, target, target === 'host' && hostConfirmed)
      setEntries((items) => items.map((item) => item.id === id ? { ...item, result } : item))
    } catch (error) {
      const message = messageOf(error); setEntries((items) => items.map((item) => item.id === id ? { ...item, error: message } : item))
    } finally { setRunning(false) }
  }

  async function reset() {
    if (target !== 'sandbox') return
    try { await api.resetTerminal(session.id); setEntries([]); setCwdByTarget((value) => ({ ...value, sandbox: '.' })) }
    catch (error) { onError(messageOf(error)) }
  }

  return <section className={`ide-terminal terminal-target-${target}`} style={{ height }}>
    <header>
      <div><Icon name="terminal" size={14}/><strong>Terminal</strong><div className="terminal-target-switch" role="group" aria-label="Destino do terminal"><button className={target === 'sandbox' ? 'active' : ''} onClick={() => selectTarget('sandbox')}>Sandbox</button><button className={target === 'host' ? 'active host' : 'host'} onClick={() => selectTarget('host')}>Host</button></div><span>{cwd}</span></div>
      <div className="terminal-controls">
        {target === 'sandbox' ? <label title="Permitir rede no próximo comando"><input type="checkbox" checked={network} onChange={(e) => setNetwork(e.target.checked)}/><Icon name="network" size={13}/> rede</label> : <span className="host-network-label" title="O terminal Host herda a rede do sistema">rede do host</span>}
        <button className="icon-button" disabled={target !== 'sandbox'} title={target === 'sandbox' ? 'Recriar sandbox a partir do host' : 'Reset só existe para a sandbox'} onClick={() => void reset()}><Icon name="reset" size={14}/></button>
        <button className="terminal-size-button" title="Aumentar/reduzir terminal" onClick={() => onHeight(height < 320 ? 390 : 245)}>↕</button>
      </div>
    </header>
    {target === 'host' && <div className="terminal-host-warning"><strong>HOST DIRECTO</strong><span>Comandos executam no projeto real. Sem sandbox e sem rollback automático.</span></div>}
    <div className="terminal-scroll">
      {entries.map((entry) => <div className={`ide-terminal-entry target-${entry.target}`} key={entry.id}><div className="terminal-prompt"><span>wharness:{entry.target}:{entry.cwd}$</span> {entry.command}</div>{entry.result?.stdout && <pre>{entry.result.stdout}</pre>}{entry.result?.stderr && <pre className="stderr">{entry.result.stderr}</pre>}{entry.result && entry.result.exit_code !== 0 && <span className="terminal-exit">exit {entry.result.exit_code}</span>}{entry.error && <pre className="stderr">{entry.error}</pre>}</div>)}
      {!entries.length && <div className="terminal-hint">{target === 'sandbox' ? 'Sandbox persistente e isolada. Sem shell implícito; comandos são argv. `cd` e `clear` são tratados pelo editor.' : 'Host explícito: executa argv diretamente no projeto real. O Policy Engine continua a negar shell arbitrário, Docker, sudo e outros comandos proibidos.'}</div>}
    </div>
    <div className="terminal-input-row"><span>wharness:{target}:{cwd}$</span><input value={input} disabled={running} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void execute() }} spellCheck={false} autoComplete="off" placeholder={running ? 'a executar…' : target === 'host' ? 'git status --short' : 'go test ./...'} /></div>
  </section>
}

function normalizeCwd(current: string, next: string) {
  const parts = (next.startsWith('/') ? next.slice(1) : `${current === '.' ? '' : current}/${next}`).split('/')
  const stack: string[] = []
  for (const part of parts) { if (!part || part === '.') continue; if (part === '..') { stack.pop(); continue } ; stack.push(part) }
  return stack.length ? stack.join('/') : '.'
}

function messageOf(error: unknown) { if (error instanceof APIError || error instanceof Error) return error.message; return 'Erro inesperado' }
