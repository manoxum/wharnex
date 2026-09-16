import { describe, expect, it } from 'vitest'
import type { PostgresQueryResult, PostgresTable } from '../types'
import {
  buildDatabaseMetadata, buildDeleteSQL, buildInsertSQL, buildUpdateSQL, quotePostgresIdentifier, sqlLiteral, triggerDDL,
} from './databaseExplorerUtils'

const table: PostgresTable = { schema: 'public', name: 'people', type: 'BASE TABLE', columns: [
  { name: 'id', data_type: 'bigint', nullable: false },
  { name: 'name', data_type: 'text', nullable: false },
  { name: 'active', data_type: 'boolean', nullable: false },
  { name: 'age', data_type: 'integer', nullable: true },
  { name: 'note', data_type: 'text', nullable: true },
] }
const result = (columns: string[], rows: unknown[][]): PostgresQueryResult => ({ columns, rows, row_count: rows.length, truncated: false, duration_ms: 1 })

describe('database explorer SQL helpers', () => {
  it('quotes identifiers and values without leaking SQL syntax', () => {
    expect(quotePostgresIdentifier('odd"name')).toBe('"odd""name"')
    expect(sqlLiteral("O'Reilly")).toBe("'O''Reilly'")
  })

  it('builds safe CRUD statements around primary keys', () => {
    expect(buildInsertSQL(table, { name: "O'Reilly", active: true, age: 42, note: null })).toBe(
      `INSERT INTO "public"."people" ("name", "active", "age", "note") VALUES ('O''Reilly', TRUE, 42, NULL) RETURNING *;`,
    )
    expect(buildUpdateSQL(table, { id: 7, name: 'Ada' }, ['id'], { id: 7, name: 'Old' })).toBe(
      `UPDATE "public"."people" SET "name" = 'Ada' WHERE "id" IS NOT DISTINCT FROM 7 RETURNING *;`,
    )
    expect(buildDeleteSQL(table, ['id'], { id: 7 })).toBe(
      `DELETE FROM "public"."people" WHERE "id" IS NOT DISTINCT FROM 7 RETURNING *;`,
    )
  })

  it('rejects unsafe row mutations before they reach PostgreSQL', () => {
    expect(() => buildUpdateSQL(table, { id: 7 }, [], { id: 7 })).toThrow('chave primária')
    expect(() => buildInsertSQL(table, { missing: 'x' })).toThrow('Coluna(s) desconhecida(s)')
    expect(() => sqlLiteral(Number.MAX_SAFE_INTEGER + 10)).toThrow('limite seguro')
  })

  it('maps catalog metadata used by views, functions, triggers and row editing', () => {
    const metadata = buildDatabaseMetadata({
      primaryKeys: result(['schema', 'table_name', 'column_name'], [['public', 'people', 'id']]),
      views: result(['schema', 'name', 'definition'], [['public', 'active_people', 'SELECT * FROM people']]),
      functions: result(['schema', 'name', 'arguments', 'returns', 'definition'], [['public', 'hello', 'name text', 'text', 'CREATE OR REPLACE FUNCTION public.hello(name text) RETURNS text LANGUAGE sql AS $$ SELECT name $$']]),
      triggers: result(['schema', 'table_name', 'name', 'definition', 'enabled'], [['public', 'people', 'audit_people', 'CREATE TRIGGER audit_people BEFORE UPDATE ON people EXECUTE FUNCTION audit()', 'enabled']]),
    })
    expect(metadata.primaryKeys['public.people']).toEqual(['id'])
    expect(metadata.views['public.active_people']).toBe('SELECT * FROM people')
    expect(metadata.functions[0]?.name).toBe('hello')
    expect(metadata.triggers[0]?.table).toBe('people')
    expect(triggerDDL(metadata.triggers[0])).toContain('CREATE OR REPLACE TRIGGER audit_people')
  })
})
