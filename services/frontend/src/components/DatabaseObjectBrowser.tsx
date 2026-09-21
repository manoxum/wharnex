import { useMemo, useState } from 'react'
import type { PostgresCatalog, PostgresTable } from '../types'
import { Icon } from './Icon'
import {
  functionDDL, isView, objectKey, tableDDL, triggerDDL, viewDDL,
  type DatabaseMetadata, type DatabaseObjectKind, type DatabaseSelection,
} from './databaseExplorerUtils'

type Props = {
  catalog?: PostgresCatalog
  metadata: DatabaseMetadata
  ddl: string
  busy: boolean
  onDDL: (value: string) => void
  onApplyDDL: () => void
}

export function DatabaseObjectBrowser({ catalog, metadata, ddl, busy, onDDL, onApplyDDL }: Props) {
  const [kind, setKind] = useState<DatabaseObjectKind>('table')
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<DatabaseSelection>()
  const tables = useMemo(() => (catalog?.tables || []).filter((table) => kind === 'view' ? isView(table) : !isView(table)), [catalog, kind])
  const filteredTables = tables.filter((table) => matches(search, `${table.schema}.${table.name}`))
  const selectedTable = selection && (selection.kind === 'table' || selection.kind === 'view')
    ? tables.find((table) => table.schema === selection.schema && table.name === selection.name)
    : undefined
  const functions = metadata.functions.filter((item) => matches(search, `${item.schema}.${item.name}(${item.arguments})`))
  const triggers = metadata.triggers.filter((item) => matches(search, `${item.schema}.${item.table}.${item.name}`))

  function selectTable(table: PostgresTable) {
    const next: DatabaseSelection = { kind: isView(table) ? 'view' : 'table', schema: table.schema, name: table.name }
    setSelection(next)
    onDDL(next.kind === 'view' ? viewDDL(table.schema, table.name, metadata.views[objectKey(table.schema, table.name)]) : tableDDL(table))
  }

  function selectFunction(index: number) {
    const item = functions[index]
    if (!item) return
    setSelection({ kind: 'function', schema: item.schema, name: item.name, arguments: item.arguments })
    onDDL(functionDDL(item))
  }

  function selectTrigger(index: number) {
    const item = triggers[index]
    if (!item) return
    setSelection({ kind: 'trigger', schema: item.schema, table: item.table, name: item.name })
    onDDL(triggerDDL(item))
  }

  function resetKind(next: DatabaseObjectKind) {
    setKind(next); setSearch(''); setSelection(undefined); onDDL(defaultDDL(next))
  }

  function createObject() { setSelection(undefined); onDDL(defaultDDL(kind)) }

  const kindIcons = { table: 'database', view: 'file', function: 'code', trigger: 'play' } as const

  return <div className="database-object-workspace">
    <div className="database-object-toolbar">
      <div className="database-object-kind-tabs" role="tablist" aria-label="Tipos de objeto">
        {(['table', 'view', 'function', 'trigger'] as const).map((item) => <button key={item} type="button" title={label(item)} className={kind === item ? 'active' : ''} onClick={() => resetKind(item)}><Icon name={kindIcons[item]} size={12}/><span className="semantic-tab-label">{label(item)}</span></button>)}
      </div>
      <button type="button" className="database-soft-button" onClick={createObject}><Icon name="plus" size={13}/> Novo</button>
    </div>
    <label className="database-object-search"><Icon name="search" size={13}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Filtrar ${label(kind).toLowerCase()}...`}/></label>
    <div className="database-object-list">
      {kind === 'table' || kind === 'view' ? filteredTables.map((table) => <button key={objectKey(table.schema, table.name)} type="button" className={selected(selection, table.schema, table.name) ? 'active' : ''} onClick={() => selectTable(table)}>
        <span className="database-object-icon"><Icon name="database" size={13}/></span><span><strong>{table.name}</strong><small>{table.schema} · {table.columns.length} colunas</small></span><em>{kind === 'view' ? 'VIEW' : 'TABLE'}</em>
      </button>) : null}
      {kind === 'function' ? functions.map((item, index) => <button key={`${item.schema}.${item.name}(${item.arguments})`} type="button" className={selection?.kind === 'function' && selection.schema === item.schema && selection.name === item.name && selection.arguments === item.arguments ? 'active' : ''} onClick={() => selectFunction(index)}>
        <span className="database-object-icon"><Icon name="code" size={13}/></span><span><strong>{item.name}</strong><small>{item.schema} · ({item.arguments || 'sem argumentos'})</small></span><em>{item.returns}</em>
      </button>) : null}
      {kind === 'trigger' ? triggers.map((item, index) => <button key={`${item.schema}.${item.table}.${item.name}`} type="button" className={selection?.kind === 'trigger' && selection.schema === item.schema && selection.table === item.table && selection.name === item.name ? 'active' : ''} onClick={() => selectTrigger(index)}>
        <span className="database-object-icon"><Icon name="refresh" size={13}/></span><span><strong>{item.name}</strong><small>{item.schema}.{item.table}</small></span><em>{item.enabled}</em>
      </button>) : null}
      {!objectCount(kind, filteredTables, functions, triggers) && <div className="right-tool-empty compact"><Icon name="search" size={20}/><span>Nenhum objeto encontrado.</span></div>}
    </div>
    {selectedTable && <div className="database-column-summary">{selectedTable.columns.map((column) => <span key={column.name}><strong>{column.name}</strong><small>{column.data_type}{column.nullable ? '' : ' · NOT NULL'}</small></span>)}</div>}
    <div className="database-ddl-editor">
      <header><div><span>DDL editor</span><strong>{selection ? selectionTitle(selection) : `Novo ${singular(kind)}`}</strong></div><span>create / alter / replace</span></header>
      <textarea value={ddl} onChange={(event) => onDDL(event.target.value)} spellCheck={false}/>
      <div className="database-editor-actions"><span>Revise o SQL antes de aplicar. Alterações são confirmadas antes da execução.</span><button type="button" className="database-primary-button" disabled={busy || !ddl.trim()} onClick={onApplyDDL}><Icon name="play" size={13}/> Aplicar DDL</button></div>
    </div>
  </div>
}

function defaultDDL(kind: DatabaseObjectKind) {
  if (kind === 'table') return tableDDL()
  if (kind === 'view') return viewDDL()
  if (kind === 'function') return functionDDL()
  return triggerDDL()
}
function label(kind: DatabaseObjectKind) { return ({ table: 'Tabelas', view: 'Views', function: 'Funções', trigger: 'Triggers' } as const)[kind] }
function singular(kind: DatabaseObjectKind) { return ({ table: 'tabela', view: 'view', function: 'função', trigger: 'trigger' } as const)[kind] }
function matches(search: string, value: string) { return !search.trim() || value.toLowerCase().includes(search.trim().toLowerCase()) }
function selected(selection: DatabaseSelection | undefined, schema: string, name: string) { return !!selection && (selection.kind === 'table' || selection.kind === 'view') && selection.schema === schema && selection.name === name }
function selectionTitle(selection: DatabaseSelection) {
  if (selection.kind === 'trigger') return `${selection.schema}.${selection.table} · ${selection.name}`
  if (selection.kind === 'function') return `${selection.schema}.${selection.name}(${selection.arguments})`
  return `${selection.schema}.${selection.name}`
}
function objectCount(kind: DatabaseObjectKind, tables: PostgresTable[], functions: DatabaseMetadata['functions'], triggers: DatabaseMetadata['triggers']) {
  if (kind === 'function') return functions.length
  if (kind === 'trigger') return triggers.length
  return tables.length
}
