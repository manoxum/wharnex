import type { CodexActivity as Activity } from '../../../lib/codex'
import { Icon, type IconName } from '../../presentation/chrome/Icon'
import { CodexMarkdown } from '../presentation'

const kinds: Record<string, { label: string; icon: IconName }> = {
  reasoning: { label: 'Resumo de progresso', icon: 'sparkles' },
  plan: { label: 'Plano de trabalho', icon: 'plan' },
  commandExecution: { label: 'Comando', icon: 'terminal' },
  fileChange: { label: 'Alterações de ficheiros', icon: 'file' },
  nativeResult: { label: 'Resultado nativo · Git e versão', icon: 'file' },
  approvalReview: { label: 'Decisão de aprovação', icon: 'shield' },
}
const statuses: Record<string, string> = { completed: 'Terminado', inProgress: 'Em curso', failed: 'Falhou', declined: 'Recusado', pending: 'Pendente', approved: 'Aprovado', denied: 'Negado', timedOut: 'Tempo esgotado', aborted: 'Interrompido' }
const changes: Record<string, string> = { update: 'Modificado', add: 'Criado', delete: 'Removido' }
const output = 'my-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-whx-border-soft bg-whx-muted p-3 font-mono text-[calc(10px*var(--ui-font-scale))] leading-5 text-whx-soft'

function ActivityContent({ item }: { item: Activity }) {
  switch (item.type) {
    case 'reasoning': return <CodexMarkdown text={(item.summary || []).join('\n\n')}/>
    case 'approvalReview': return <><CodexMarkdown text={item.explanation || ''}/>{item.riskLevel && <p className="mb-0 text-whx-faint">Risco reportado pelo Codex: {item.riskLevel}</p>}</>
    case 'plan': return <>
      {item.explanation && <p className="mb-3 mt-0 leading-6 text-whx-soft">{item.explanation}</p>}
      <ol className="m-0 flex flex-col gap-2 p-0 [list-style:none]">{item.plan?.map((step, index) => <li key={index} className={`flex items-start gap-2 leading-5 ${step.status === 'completed' ? 'text-whx-faint' : 'text-whx-text'}`}>
        <span className={`mt-0.5 shrink-0 ${step.status === 'inProgress' ? 'text-whx-accent' : ''}`} title={statuses[step.status] || step.status}><Icon name={step.status === 'completed' ? 'check' : step.status === 'inProgress' ? 'arrow-right' : 'minus'} size={14}/></span>
        <span className="sr-only">{statuses[step.status] || step.status}: </span>{step.step}
      </li>)}</ol>
    </>
    case 'commandExecution': return <>
      <code className="block whitespace-pre-wrap break-all rounded-md bg-whx-muted px-2.5 py-2 font-mono text-[calc(10px*var(--ui-font-scale))] leading-5">{item.command}</code>
      {item.cwd && <p className="mb-0 mt-2 break-all font-mono text-[calc(9px*var(--ui-font-scale))] text-whx-faint">{item.cwd}</p>}
      {item.aggregatedOutput && <details className="mt-2"><summary className="cursor-pointer py-1 text-[calc(10px*var(--ui-font-scale))] text-whx-faint">Resultado</summary><pre className={output}>{item.aggregatedOutput}</pre></details>}
    </>
    case 'nativeResult':
    case 'fileChange': return <div className="flex flex-col gap-2">{item.explanation && <CodexMarkdown text={item.explanation}/>} {item.changes?.map((change) => <details key={change.path}>
      <summary className="cursor-pointer break-all py-1 font-mono text-[calc(10px*var(--ui-font-scale))]">{change.path}<span className="ml-2 font-sans text-whx-faint">· {changes[change.kind?.type] || change.kind?.type}</span></summary>
      <pre className={output}>{change.diff}</pre>
    </details>)}</div>
    default: return <p className="m-0 break-all font-mono text-whx-soft">{item.server} {item.tool}</p>
  }
}

export function CodexActivity({ items }: { items: Activity[] }) {
  if (!items.length) return null
  return <details open className="mb-6 rounded-xl border border-whx-border-soft" aria-label="Atividade do Codex">
    <summary className="cursor-pointer rounded-t-xl bg-whx-muted/40 px-3 py-3 text-[calc(11px*var(--ui-font-scale))] font-medium text-whx-soft">Atividade <span className="ml-2 text-[calc(10px*var(--ui-font-scale))] font-normal text-whx-faint">· {items.length} {items.length === 1 ? 'etapa' : 'etapas'}</span></summary>
    <div className="px-3">{items.map((item) => {
      const kind = kinds[item.type] || { label: 'Ferramenta', icon: 'build' }
      return <section key={item.id} className="min-w-0 border-t border-whx-border-soft py-3 text-[calc(11px*var(--ui-font-scale))]">
        <div className="mb-3 flex flex-wrap items-center gap-2"><span className="text-whx-faint"><Icon name={kind.icon} size={15}/></span><h4 className="m-0 flex-1 text-[calc(10px*var(--ui-font-scale))] font-semibold">{kind.label}</h4>
          <span className={`text-[calc(9px*var(--ui-font-scale))] ${item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0) ? 'text-whx-warning' : 'text-whx-faint'}`}>{statuses[item.status || ''] || item.status}{item.exitCode != null ? ` · saída ${item.exitCode}` : ''}</span>
        </div>
        <ActivityContent item={item}/>
      </section>
    })}</div>
  </details>
}
