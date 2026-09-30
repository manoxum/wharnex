import type { PostgresQueryResult, PostgresTable } from '../../../types'

export type DatabaseObjectKind = 'table' | 'view' | 'function' | 'trigger'
export type DatabaseFunction = { schema: string; name: string; arguments: string; returns: string; definition: string }
export type DatabaseTrigger = { schema: string; table: string; name: string; definition: string; enabled: string }
export type DatabaseMetadata = {
  primaryKeys: Record<string, string[]>
  views: Record<string, string>
  functions: DatabaseFunction[]
  triggers: DatabaseTrigger[]
}

export type DatabaseSelection =
  | { kind: 'table' | 'view'; schema: string; name: string }
  | { kind: 'function'; schema: string; name: string; arguments: string }
  | { kind: 'trigger'; schema: string; table: string; name: string }

export const EMPTY_DATABASE_METADATA: DatabaseMetadata = { primaryKeys: {}, views: {}, functions: [], triggers: [] }

export const DATABASE_METADATA_SQL = {
  primaryKeys: `SELECT kcu.table_schema AS schema, kcu.table_name AS table_name, kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
 AND tc.table_name = kcu.table_name
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position;`,
  views: `SELECT n.nspname AS schema, c.relname AS name, pg_get_viewdef(c.oid, true) AS definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname;`,
  functions: `SELECT n.nspname AS schema, p.proname AS name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS returns,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prokind = 'f' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, p.proname, arguments;`,
  triggers: `SELECT n.nspname AS schema, c.relname AS table_name, t.tgname AS name,
       pg_get_triggerdef(t.oid, true) AS definition,
       CASE t.tgenabled WHEN 'D' THEN 'disabled' WHEN 'R' THEN 'replica' WHEN 'A' THEN 'always' ELSE 'enabled' END AS enabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname, t.tgname;`,
} as const

export function buildDatabaseMetadata(results: {
  primaryKeys: PostgresQueryResult
  views: PostgresQueryResult
  functions: PostgresQueryResult
  triggers: PostgresQueryResult
}): DatabaseMetadata {
  const primaryKeys: Record<string, string[]> = {}
  for (const row of resultRowsToObjects(results.primaryKeys)) {
    const key = objectKey(text(row.schema), text(row.table_name))
    primaryKeys[key] = [...(primaryKeys[key] || []), text(row.column_name)]
  }
  const views: Record<string, string> = {}
  for (const row of resultRowsToObjects(results.views)) views[objectKey(text(row.schema), text(row.name))] = text(row.definition)
  return {
    primaryKeys,
    views,
    functions: resultRowsToObjects(results.functions).map((row) => ({
      schema: text(row.schema), name: text(row.name), arguments: text(row.arguments), returns: text(row.returns), definition: text(row.definition),
    })),
    triggers: resultRowsToObjects(results.triggers).map((row) => ({
      schema: text(row.schema), table: text(row.table_name), name: text(row.name), definition: text(row.definition), enabled: text(row.enabled),
    })),
  }
}

export function resultRowsToObjects(result: PostgresQueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])))
}

export function objectKey(schema: string, name: string) { return `${schema}.${name}` }
export function isView(table: PostgresTable) { return table.type.toUpperCase().includes('VIEW') }
export function quotePostgresIdentifier(value: string) { return `"${value.replaceAll('"', '""')}"` }
export function qualifiedName(schema: string, name: string) { return `${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(name)}` }

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Valores numéricos devem ser finitos.')
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('Inteiros acima do limite seguro do JavaScript não podem ser editados por esta interface.')
    return String(value)
  }
  const textValue = typeof value === 'string' ? value : JSON.stringify(value)
  return `'${String(textValue).replaceAll("'", "''")}'`
}

export function buildBrowseSQL(table: PostgresTable, limit = 100) {
  return `SELECT * FROM ${qualifiedName(table.schema, table.name)} LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))};`
}

export function buildInsertSQL(table: PostgresTable, record: Record<string, unknown>) {
  validateRecordColumns(table, record)
  const entries = Object.entries(record)
  if (!entries.length) return `INSERT INTO ${qualifiedName(table.schema, table.name)} DEFAULT VALUES RETURNING *;`
  const columns = entries.map(([column]) => quotePostgresIdentifier(column)).join(', ')
  const values = entries.map(([, value]) => sqlLiteral(value)).join(', ')
  return `INSERT INTO ${qualifiedName(table.schema, table.name)} (${columns}) VALUES (${values}) RETURNING *;`
}

export function buildUpdateSQL(table: PostgresTable, record: Record<string, unknown>, primaryKeys: string[], original: Record<string, unknown>) {
  if (!primaryKeys.length) throw new Error('A tabela não tem chave primária; edição segura não está disponível.')
  validateRecordColumns(table, record)
  const updates = Object.entries(record).filter(([column, value]) => !primaryKeys.includes(column) && !sameValue(value, original[column]))
  if (!updates.length) throw new Error('Não existem alterações para guardar fora da chave primária.')
  const set = updates.map(([column, value]) => `${quotePostgresIdentifier(column)} = ${sqlLiteral(value)}`).join(', ')
  return `UPDATE ${qualifiedName(table.schema, table.name)} SET ${set} WHERE ${primaryKeyPredicate(primaryKeys, original)} RETURNING *;`
}

export function buildDeleteSQL(table: PostgresTable, primaryKeys: string[], original: Record<string, unknown>) {
  if (!primaryKeys.length) throw new Error('A tabela não tem chave primária; eliminação segura não está disponível.')
  return `DELETE FROM ${qualifiedName(table.schema, table.name)} WHERE ${primaryKeyPredicate(primaryKeys, original)} RETURNING *;`
}

export function tableDDL(table?: PostgresTable) {
  if (!table) return 'CREATE TABLE public.new_table (\n  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n  created_at timestamptz NOT NULL DEFAULT now()\n);'
  return `ALTER TABLE ${qualifiedName(table.schema, table.name)}\n  ADD COLUMN new_column text;`
}

export function viewDDL(schema = 'public', name = 'new_view', definition = '') {
  const body = definition.trim().replace(/;$/, '') || 'SELECT 1 AS example'
  return `CREATE OR REPLACE VIEW ${qualifiedName(schema, name)} AS\n${body};`
}

export function functionDDL(item?: DatabaseFunction) {
  if (item?.definition.trim()) return ensureSemicolon(item.definition.trim())
  return `CREATE OR REPLACE FUNCTION public.new_function()\nRETURNS void\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  -- implementation\nEND;\n$$;`
}

export function triggerDDL(item?: DatabaseTrigger) {
  if (!item?.definition.trim()) return `CREATE OR REPLACE TRIGGER new_trigger\nBEFORE INSERT ON public.target_table\nFOR EACH ROW\nEXECUTE FUNCTION public.trigger_function();`
  return ensureSemicolon(item.definition.trim().replace(/^CREATE\s+TRIGGER\b/i, 'CREATE OR REPLACE TRIGGER'))
}

function primaryKeyPredicate(primaryKeys: string[], original: Record<string, unknown>) {
  return primaryKeys.map((column) => `${quotePostgresIdentifier(column)} IS NOT DISTINCT FROM ${sqlLiteral(original[column])}`).join(' AND ')
}
function validateRecordColumns(table: PostgresTable, record: Record<string, unknown>) {
  const allowed = new Set(table.columns.map((column) => column.name))
  const unknown = Object.keys(record).filter((column) => !allowed.has(column))
  if (unknown.length) throw new Error(`Coluna(s) desconhecida(s): ${unknown.join(', ')}.`)
}
function sameValue(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true
  if (typeof left === 'object' && typeof right === 'object') {
    try { return JSON.stringify(left) === JSON.stringify(right) } catch { return false }
  }
  return false
}
function ensureSemicolon(value: string) { return value.endsWith(';') ? value : `${value};` }
function text(value: unknown) { return value === null || value === undefined ? '' : String(value) }
