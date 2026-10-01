import { useMemo, useState } from 'react'
import type { PostgresCatalog, PostgresQueryResult, PostgresTable } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import {
  buildBrowseSQL, buildDeleteSQL, buildInsertSQL, buildUpdateSQL, isView, objectKey, resultRowsToObjects,
  type DatabaseMetadata,
} from './databaseExplorerUtils'

type WritePrompt = { title: string; message: string; confirmLabel: string }
type Props = {
  catalog?: PostgresCatalog
  metadata: DatabaseMetadata
  busy: boolean
  onRead: (sql: string) => Promise<PostgresQueryResult | undefined>
  onWrite: (sql: string, prompt: WritePrompt) => Promise<PostgresQueryResult | undefined>
  onError: (message: string) => void
}
type EditorState = { mode: 'create' | 'edit'; draft: string; original?: Record<string, unknown> }

export function DatabaseDataBrowser({ catalog, metadata, busy, onRead, onWrite, onError }: Props) {
  const tables = useMemo(() => (catalog?.tables || []).filter((table) => !isView(table)), [catalog])
  const [selectedKey, setSelectedKey] = useState('')
  const [result, setResult] = useState<PostgresQueryResult>()
  const [editor, setEditor] = useState<EditorState>()
  const selected = tables.find((table) => objectKey(table.schema, table.name) === selectedKey)
  const primaryKeys = selected ? metadata.primaryKeys[objectKey(selected.schema, selected.name)] || [] : []
  const rows = result ? resultRowsToObjects(result) : []

  async function load(table: PostgresTable) {
    setSelectedKey(objectKey(table.schema, table.name)); setEditor(undefined)
    const next = await onRead(buildBrowseSQL(table))
    if (next) setResult(next)
  }

  async function refresh() { if (selected) { const next = await onRead(buildBrowseSQL(selected)); if (next) setResult(next) } }

  async function saveRecord() {
    if (!selected || !editor) return
    let record: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(editor.draft)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('O registro deve ser um objeto JSON.')
      record = parsed as Record<string, unknown>
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
      return
    }
    try {
      const sql = editor.mode === 'create' ? buildInsertSQL(selected, record) : buildUpdateSQL(selected, record, primaryKeys, editor.original || {})
      const next = await onWrite(sql, {
        title: editor.mode === 'create' ? 'Criar registro?' : 'Guardar alterações?',
        message: `A operação vai escrever em ${selected.schema}.${selected.name}. Confirme depois de rever os valores em JSON.`,
        confirmLabel: editor.mode === 'create' ? 'Criar registro' : 'Guardar alterações',
      })
      if (next) { setEditor(undefined); await refresh() }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  async function deleteRecord(row: Record<string, unknown>) {
    if (!selected) return
    try {
      const next = await onWrite(buildDeleteSQL(selected, primaryKeys, row), {
        title: 'Eliminar registro?', message: `Esta ação elimina um registro de ${selected.schema}.${selected.name} usando a chave primária selecionada.`, confirmLabel: 'Eliminar registro',
      })
      if (next) await refresh()
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  return <div className="database-data-workspace">
    <div className="database-data-toolbar">
      <label><span>Tabela</span><select value={selectedKey} onChange={(event) => { const table = tables.find((item) => objectKey(item.schema, item.name) === event.target.value); if (table) void load(table) }}>
        <option value="">Selecionar tabela...</option>{tables.map((table) => <option key={objectKey(table.schema, table.name)} value={objectKey(table.schema, table.name)}>{table.schema}.{table.name}</option>)}
      </select></label>
      <button type="button" className="database-soft-button" disabled={!selected || busy} onClick={() => void refresh()}><Icon name="refresh" size={13}/> Atualizar</button>
      <button type="button" className="database-primary-button" disabled={!selected || busy} onClick={() => setEditor({ mode: 'create', draft: '{}'})}><Icon name="plus" size={13}/> Novo registro</button>
    </div>
    {selected && <div className="database-data-context"><span><strong>{selected.schema}.{selected.name}</strong> · até 100 registros</span><span className={primaryKeys.length ? 'ready' : 'warning'}>{primaryKeys.length ? `PK: ${primaryKeys.join(', ')}` : 'Sem PK · edição/eliminação desativadas'}</span></div>}
    {editor && selected && <div className="database-record-editor">
      <header><div><span>{editor.mode === 'create' ? 'Novo registro' : 'Editar registro'}</span><strong>{selected.schema}.{selected.name}</strong></div><button type="button" onClick={() => setEditor(undefined)} aria-label="Fechar editor"><Icon name="close" size={13}/></button></header>
      <p>Edite um objeto JSON. Campos omitidos usam o valor DEFAULT ao criar; use <code>null</code> para gravar NULL.</p>
      <textarea className="database-json-editor" value={editor.draft} onChange={(event) => setEditor({ ...editor, draft: event.target.value })} spellCheck={false}/>
      <div className="database-editor-actions"><span>{editor.mode === 'edit' && primaryKeys.length ? `Identidade: ${primaryKeys.map((key) => `${key}=${displayValue(editor.original?.[key])}`).join(' · ')}` : 'Os valores são convertidos em literais PostgreSQL seguros.'}</span><button type="button" className="database-primary-button" disabled={busy} onClick={() => void saveRecord()}><Icon name="save" size={13}/> {editor.mode === 'create' ? 'Criar' : 'Guardar'}</button></div>
    </div>}
    <div className="database-data-grid-wrap">
      {result && result.columns.length ? <table className="database-data-grid"><thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}<th className="database-row-actions-heading">Ações</th></tr></thead><tbody>{result.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{displayValue(value)}</td>)}<td className="database-row-actions"><button type="button" disabled={!primaryKeys.length || busy} title={primaryKeys.length ? 'Editar registro' : 'Requer chave primária'} onClick={() => setEditor({ mode: 'edit', draft: JSON.stringify(rows[rowIndex] || {}, null, 2), original: rows[rowIndex] })}><Icon name="edit" size={12}/></button><button type="button" disabled={!primaryKeys.length || busy} title={primaryKeys.length ? 'Eliminar registro' : 'Requer chave primária'} onClick={() => void deleteRecord(rows[rowIndex] || {})}><Icon name="trash" size={12}/></button></td></tr>)}</tbody></table> : <div className="right-tool-empty"><Icon name="database" size={24}/><strong>Explore os dados com segurança</strong><span>Selecione uma tabela para visualizar registros. Criar, editar e eliminar ficam disponíveis no mesmo painel.</span></div>}
    </div>
    {result && <div className="database-data-footer"><span>{result.row_count} linha(s){result.truncated ? ' · resultado truncado' : ''}</span><span>{result.duration_ms} ms</span></div>}
  </div>
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') { try { return JSON.stringify(value) } catch { return String(value) } }
  return String(value)
}
