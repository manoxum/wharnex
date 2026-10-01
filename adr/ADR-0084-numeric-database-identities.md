# ADR-0084 — Numeric database identities with stable public identifiers

Status: Accepted — 2026-09-29

## Context

Wharnex tables have used text and composite primary keys. Related tables often
store another record's string identifier, so joins repeat public identifiers and
cannot rely on database foreign keys consistently. Existing installations and
external clients already depend on those strings; replacing them at the API
boundary would break persisted chats, tasks, events and request links.

## Decision

Each project-owned PostgreSQL base table has a generated `bigint id` primary
key, a unique immutable `sid text`, and a unique immutable `uid uuid` generated
by PostgreSQL. `sid` preserves each old single-column string key exactly.
Composite former keys receive a deterministic versioned encoding. A legacy SID
that happens to have UUID syntax remains a SID; syntax alone never changes its
meaning or rewrites it as a UID. Lookups are scoped to the resource kind.

Relational references use bigint foreign keys to the target `id`. Persistence
joins and relationship mutations use those numeric columns. Old text reference
columns may remain as compatibility data, including historical links whose
target no longer exists. External requests and responses use `sid` or `uid`;
the backend resolves them at the boundary and does not expose numeric IDs as
public identifiers. Provider-owned identifiers and ordinary labels remain
strings.

## Migration and compatibility impact

The shared SQL migration runs at startup after legacy table initialization,
inside a transaction guarded by a database advisory lock. It backfills numeric
keys and relationships, preserves existing SIDs, and generates UIDs once.
Reapplication must preserve all three identifiers, row counts, payloads and
resolved relationships. A failed migration rolls back, leaves the database
volume intact, and can be retried on the next startup. Legacy string clients
continue to address records through SID; UID support is additive. Old stored
UUID-shaped strings remain eligible for exact SID resolution; syntax alone
cannot redirect them to UID. If the same input matches different SID and UID
records of that kind, resolution fails as ambiguous.

## Verification

`SoT/DATABASE_IDENTIFIERS.md` defines the detailed invariant. The G12 quality
gate in `SoT/QUALITY_GATES.md` inspects the PostgreSQL catalog after both stores
initialize, applies the migration twice, and checks seeded legacy identifiers,
versioned composite SIDs, numeric foreign keys and stable row identities.
Boundary and persistence tests cover string/UUID input resolution and numeric
relationship queries. Releases that change this contract run the gate against
PostgreSQL 17; a skipped database test is not release evidence.
