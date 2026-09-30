import { useMemo, useState } from 'react'
import type { TerminalRunInput } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'

type ExternalAgentId = 'codex' | 'claude' | 'cline'
type ExternalAgent = { id: ExternalAgentId; name: string; vendor: string; cli: string; extension: string; summary: string }

const EXTERNAL_AGENTS: ExternalAgent[] = [
  { id: 'codex', name: 'Codex', vendor: 'OpenAI', cli: 'codex', extension: 'openai.chatgpt', summary: 'Coding agent da OpenAI com extensão oficial para VS Code.' },
  { id: 'claude', name: 'Claude Code', vendor: 'Anthropic', cli: 'claude', extension: 'anthropic.claude-code', summary: 'Agente de desenvolvimento da Anthropic, com aprovações no próprio runtime.' },
  { id: 'cline', name: 'Cline', vendor: 'Cline', cli: 'cline', extension: 'saoudrizwan.claude-dev', summary: 'Agente open-source orientado a tarefas e ferramentas no workspace.' },
]

const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-whx-border-soft bg-whx-bg px-3 text-sm font-semibold text-whx-soft transition hover:border-whx-border hover:bg-whx-hover hover:text-whx-text disabled:cursor-not-allowed disabled:opacity-40'
const primaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-whx-accent/50 bg-whx-accent-soft px-4 text-sm font-bold text-whx-text transition hover:border-whx-accent hover:bg-whx-hover disabled:cursor-not-allowed disabled:opacity-40'

function shellQuote(value: string) { return `'${value.replace(/'/g, `'"'"'`)}'` }
function extensionCommand(extension: string) { return `code --install-extension ${extension} --force` }

export function ExternalAgentsPanel({ projectPath, onRunInTerminal }: { projectPath: string; onRunInTerminal?: (input: TerminalRunInput) => void }) {
  const [selectedId, setSelectedId] = useState<ExternalAgentId>('codex')
  const [prompt, setPrompt] = useState('')
  const selected = useMemo(() => EXTERNAL_AGENTS.find((agent) => agent.id === selectedId) || EXTERNAL_AGENTS[0], [selectedId])
  const available = Boolean(onRunInTerminal)

  const run = (command: string, label: string) => onRunInTerminal?.({ command, cwd: projectPath, label: `Agentes IA · ${label}` })
  const sendPrompt = () => {
    const value = prompt.trim()
    if (!value || !available) return
    run(`${selected.cli} ${shellQuote(value)}`, selected.name)
  }
  const updateAll = () => run(EXTERNAL_AGENTS.map((agent) => extensionCommand(agent.extension)).join('; '), 'Atualizar plugins')

  return <section className="flex h-full min-h-0 flex-col bg-whx-surface text-whx-text" aria-label="Hub de agentes IA">
    <header className="border-b border-whx-border bg-whx-elevated px-4 pb-4 pt-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-whx-accent/30 bg-whx-accent-soft text-whx-accent"><Icon name="sparkles" size={19}/></span>
        <div className="min-w-0"><span className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-whx-accent">Agentes externos</span><h2 className="mb-0 mt-1 text-lg font-semibold">Codex, Claude Code e Cline</h2><p className="mb-0 mt-1 text-sm leading-5 text-whx-faint">Escreva uma instrução no Wharnex e entregue-a ao agente no terminal integrado do projeto.</p></div>
      </div>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="grid gap-2" role="radiogroup" aria-label="Escolher agente">
        {EXTERNAL_AGENTS.map((agent) => {
          const active = agent.id === selectedId
          return <button key={agent.id} type="button" role="radio" aria-checked={active} className={`grid min-w-0 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${active ? 'border-whx-accent/55 bg-whx-accent-soft' : 'border-whx-border-soft bg-whx-elevated hover:border-whx-border hover:bg-whx-hover'}`} onClick={() => setSelectedId(agent.id)}>
            <span className={`grid size-9 place-items-center rounded-lg border ${active ? 'border-whx-accent/35 bg-whx-surface text-whx-accent' : 'border-whx-border-soft bg-whx-bg text-whx-soft'}`}><Icon name={agent.id === 'codex' ? 'chatgpt' : agent.id === 'claude' ? 'sparkles' : 'agent'} size={17}/></span>
            <span className="min-w-0"><span className="flex flex-wrap items-center gap-1.5"><strong className="text-sm">{agent.name}</strong><small className="rounded-full border border-whx-border-soft bg-whx-bg px-1.5 py-0.5 text-xs text-whx-faint">{agent.vendor}</small></span><span className="mt-1 block text-xs leading-4 text-whx-faint">{agent.summary}</span></span>
            <span className={`size-2 rounded-full ${active ? 'bg-whx-accent' : 'bg-whx-border'}`} aria-hidden="true"/>
          </button>
        })}
      </div>

      <div className="mt-3 rounded-xl border border-whx-border-soft bg-whx-elevated p-3">
        <label htmlFor="external-agent-prompt" className="mb-2 flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-[0.08em] text-whx-faint"><span>Prompt para {selected.name}</span><span className="font-mono normal-case tracking-normal">{selected.cli}</span></label>
        <textarea id="external-agent-prompt" aria-label={`Prompt para ${selected.name}`} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); sendPrompt() } }} className="min-h-32 w-full resize-y rounded-xl border border-whx-border bg-whx-bg p-3 text-sm leading-5 text-whx-text outline-none placeholder:text-whx-faint focus:border-whx-accent" placeholder="Descreva a tarefa, ficheiros relevantes, restrições e resultado esperado…" spellCheck />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-whx-faint">Ctrl/Cmd + Enter envia · cwd: <code className="font-mono text-whx-soft">{projectPath}</code></span><button type="button" className={primaryButton} disabled={!prompt.trim() || !available} onClick={sendPrompt}><Icon name="send" size={14}/> Enviar para {selected.name}</button></div>
        {!available && <p className="mb-0 mt-2 rounded-lg border border-whx-warning/35 bg-whx-bg px-2.5 py-2 text-xs leading-4 text-whx-warning">O terminal integrado não está disponível nesta superfície.</p>}
      </div>

      <section className="mt-3 rounded-xl border border-whx-border-soft bg-whx-elevated p-3" aria-label="Plugins oficiais do VS Code">
        <div className="flex items-start justify-between gap-3"><div><span className="text-xs font-bold uppercase tracking-[0.08em] text-whx-faint">Plugins oficiais do VS Code</span><p className="mb-0 mt-1 text-xs leading-4 text-whx-faint">O VS Code gere os plugins; o envio direto usa as CLIs oficiais para não depender de comandos internos instáveis. As atualizações ficam auditáveis no terminal.</p></div><Icon name="package" size={16}/></div>
        <div className="mt-3 grid gap-2">
          {EXTERNAL_AGENTS.map((agent) => <div key={agent.extension} className="flex min-w-0 items-center gap-2 rounded-lg border border-whx-border-soft bg-whx-bg p-2"><div className="min-w-0 flex-1"><strong className="block text-xs">{agent.name}</strong><code className="block truncate font-mono text-xs text-whx-faint">{agent.extension}</code></div><button type="button" className={button} disabled={!available} onClick={() => run(extensionCommand(agent.extension), `Plugin ${agent.name}`)}><Icon name="refresh" size={13}/> Atualizar</button></div>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={primaryButton} disabled={!available} onClick={updateAll}><Icon name="refresh" size={14}/> Atualizar todos</button><button type="button" className={button} disabled={!available} onClick={() => run("code --list-extensions --show-versions; printf '\\n--- CLIs ---\\n'; codex --version; claude --version; cline --version", 'Diagnóstico dos agentes')}><Icon name="list" size={13}/> Diagnosticar</button><button type="button" className={button} disabled={!available} onClick={() => run('code .', 'Abrir VS Code')}><Icon name="external" size={13}/> Abrir VS Code</button></div>
      </section>

      <aside className="mt-3 flex gap-2 rounded-xl border border-whx-border-soft bg-whx-bg p-3 text-xs leading-5 text-whx-faint"><span className="mt-0.5 text-whx-accent"><Icon name="shield" size={14}/></span><p className="m-0"><strong className="text-whx-soft">Aprovações permanecem no agente.</strong> O Wharnex só inicia a CLI no diretório do projeto; não ativa flags de bypass nem tenta automatizar diálogos de confiança dos agentes.</p></aside>
    </div>
  </section>
}
