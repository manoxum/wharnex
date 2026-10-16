import { Button, IconButton, Input, Select } from '../../../presentation/workbench'

type Props = {
  project: string; category: string; query: string; projects: string[]; categories: string[]
  categoryLabel: (value: string) => string; placeholder: string; allSelected: boolean
  onProject: (value: string) => void; onCategory: (value: string) => void; onQuery: (value: string) => void; onToggleAll: () => void
}
export function EvidenceFilters(props: Props) {
  return <div className="mt-2 grid grid-cols-1 gap-2 @min-[520px]/evidence:grid-cols-2 @min-[960px]/evidence:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto]">
    <Select aria-label="Filtrar projeto" className="!h-8 !py-1" value={props.project} onChange={(event) => props.onProject(event.target.value)}><option value="">Todos os projetos</option>{props.projects.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
    <Select aria-label="Filtrar categoria" className="!h-8 !py-1" value={props.category} onChange={(event) => props.onCategory(event.target.value)}><option value="">Todas as categorias</option>{props.categories.map((value) => <option key={value} value={value}>{props.categoryLabel(value)}</option>)}</Select>
    <div className="flex min-w-0 items-center gap-1">
      <Input aria-label="Pesquisar evidência" type="search" className="!h-8 !w-full !py-1" placeholder={props.placeholder} value={props.query} onChange={(event) => props.onQuery(event.target.value)}/>
      {props.query && <IconButton icon="close" label="Limpar pesquisa" onClick={() => props.onQuery('')}/>}
    </div>
    <Button tone="quiet" className="!justify-self-start" onClick={props.onToggleAll}>{props.allSelected ? 'Desmarcar resultados' : 'Selecionar resultados'}</Button>
  </div>
}
