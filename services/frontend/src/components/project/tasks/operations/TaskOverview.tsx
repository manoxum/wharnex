import { Icon } from '../../../presentation/chrome/Icon'
import { IconButton, Input, PanelHeader, Select } from '../../../presentation/workbench'

export function TaskOverview({ counts, runningCount, attentionCount, query, source, onQuery, onSource, onClose }: {
  counts: { queue: number; completed: number }; runningCount: number; attentionCount: number; query: string; source: string
  onQuery: (query: string) => void; onSource: (source: string) => void; onClose: () => void
}) {
  return <>
    <PanelHeader title="Tarefas do projeto" description="Trabalho em curso, atenção e histórico." icon="list" actions={<IconButton label="Fechar tarefas" icon="close" onClick={onClose}/>}/>
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-whx-border-soft px-4 py-3" aria-label="Resumo operacional">
      {[{ label: 'Ativas', value: counts.queue, icon: 'list' as const }, { label: 'Em execução', value: runningCount, icon: 'play' as const }, { label: 'Atenção', value: attentionCount, icon: 'alert' as const }, { label: 'Concluídas', value: counts.completed, icon: 'check' as const }].map((metric) => <div key={metric.label} className={`flex items-center gap-2 text-whx-caption ${metric.label === 'Atenção' && attentionCount > 0 ? 'text-whx-danger' : 'text-whx-faint'}`}><Icon name={metric.icon} size={13}/><span className="flex-1">{metric.label}</span><b className="font-mono text-whx-label">{metric.value}</b></div>)}
    </div>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2 px-3 py-3" role="group" aria-label="Pesquisa e origem das tarefas">
      <Input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Pesquisar tarefas…" aria-label="Pesquisar tarefas"/>
      <Select value={source} onChange={(event) => onSource(event.target.value)} aria-label="Filtrar tarefas por origem"><option value="all">Todas as origens</option><option value="chat">Chats</option><option value="worker">Workers</option><option value="orchestrator">Orquestração</option><option value="translation">Traduções</option><option value="release">Releases</option><option value="todo">TODO</option><option value="system">Sistema</option></Select>
    </div>
  </>
}
