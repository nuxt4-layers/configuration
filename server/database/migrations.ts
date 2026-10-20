import type { PostgresPoolLike } from '../../shared/contracts'

/**
 * PRIVATE. Versioned, append-only migrations for Configuration's schema
 * (ADR-0002). `{{schema}}` is replaced with the validated, quoted schema
 * identifier. Never edit a released migration; add a new one.
 */
export const CONFIGURATION_MIGRATIONS: readonly { id: string, sql: string }[] = [
  {
    id: '0001_values_changes_history_outbox',
    sql: `
-- Values set at a scope. The platform's scope_id is ''; tenant_id is the
-- tenant a tenant or group value belongs to, so a tenant disposes of its own.
create table {{schema}}."value" (
  "scope" text not null check ("scope" in ('platform', 'tenant', 'group')),
  "scope_id" text not null,
  "tenant_id" text,
  "key" text not null,
  "value" jsonb not null,
  "change_id" text not null,
  "updated_at" timestamptz not null,
  primary key ("scope", "scope_id", "key"),
  check (("scope" = 'platform') = ("scope_id" = '' and "tenant_id" is null))
);
create index "value_tenant_idx" on {{schema}}."value" ("tenant_id");

-- Pending changes (docs/contracts.md §6, §7).
create table {{schema}}."change" (
  "change_id" text primary key,
  "scope" text not null check ("scope" in ('platform', 'tenant', 'group')),
  "scope_id" text not null,
  "tenant_id" text,
  "governing_group_id" text not null,
  "requester_id" text not null,
  "controlled_ids" jsonb not null,
  "risk" text not null check ("risk" in ('low', 'medium', 'high', 'critical')),
  "route" text not null check ("route" in ('none', 'approvers', 'parent-owner', 'tenant-owner', 'published-delay')),
  "required_approvals" integer not null check ("required_approvals" >= 0),
  "group_requirement" integer not null check ("group_requirement" >= 0),
  "owner_group_id" text,
  "set" jsonb not null,
  "expected" jsonb not null,
  "justification" jsonb not null,
  "digest" text not null,
  "status" text not null check ("status" in ('awaiting', 'delayed', 'applied', 'rejected', 'expired', 'cancelled')),
  "reason_code" text,
  "requested_at" timestamptz not null,
  "expires_at" timestamptz,
  "applies_at" timestamptz,
  "held_until" timestamptz,
  "decided_at" timestamptz,
  "correlation_id" text not null,
  check (("route" in ('parent-owner', 'tenant-owner')) = ("owner_group_id" is not null)),
  check ("status" <> 'delayed' or "applies_at" is not null)
);
create index "change_open_idx" on {{schema}}."change" ("status") where "status" in ('awaiting', 'delayed');
create index "change_scope_idx" on {{schema}}."change" ("scope", "scope_id");
create index "change_tenant_idx" on {{schema}}."change" ("tenant_id");

-- Approvals and rejections, each bound to the digest the approver was shown.
create table {{schema}}."approval" (
  "change_id" text not null references {{schema}}."change" ("change_id") on delete cascade,
  "approver_id" text not null,
  "decision" text not null check ("decision" in ('approve', 'reject')),
  "decided_at" timestamptz not null,
  "assurance" jsonb not null,
  "digest" text not null,
  primary key ("change_id", "approver_id")
);

-- What each applied change did to each key.
create table {{schema}}."history" (
  "sequence" bigserial primary key,
  "change_id" text not null,
  "scope" text not null,
  "scope_id" text not null,
  "tenant_id" text,
  "key" text not null,
  "previous" jsonb,
  "next" jsonb,
  "possibly_personal" boolean not null,
  "applied_at" timestamptz not null
);
create index "history_scope_idx" on {{schema}}."history" ("scope", "scope_id", "sequence");
create index "history_tenant_idx" on {{schema}}."history" ("tenant_id");

-- Transactional outbox: written in the same transaction as the change.
create table {{schema}}."outbox" (
  "sequence" bigserial primary key,
  "event" jsonb not null,
  "created_at" timestamptz not null,
  "published_at" timestamptz
);
create index "outbox_unpublished_idx" on {{schema}}."outbox" ("sequence") where "published_at" is null;
`,
  },
  {
    // Requests resolve their tenant from the host name (docs/contracts.md §4.1).
    id: '0002_host_names',
    sql: `
create index "value_host_names_idx" on {{schema}}."value" using gin ("value" jsonb_path_ops) where "key" = 'site.host-names';
`,
  },
  {
    // Tenant states as Identity's events announce them, and the events
    // already applied (consumers are idempotent by event id).
    id: '0003_identity_events',
    sql: `
create table {{schema}}."tenant" (
  "tenant_id" text primary key,
  "state" text not null check ("state" in ('active', 'closing', 'closed')),
  "updated_at" timestamptz not null
);
create table {{schema}}."processed_event" (
  "event_id" text primary key,
  "processed_at" timestamptz not null
);
`,
  },
  {
    // A person's own account (docs/contracts.md §4.2): scope_id is the
    // identity, tenant_id null (it is no tenant's data).
    id: '0004_account_scope',
    sql: `
alter table {{schema}}."value" drop constraint "value_scope_check",
  add constraint "value_scope_check" check ("scope" in ('platform', 'tenant', 'group', 'account')),
  add constraint "value_account_check" check ("scope" <> 'account' or "tenant_id" is null);
alter table {{schema}}."change" drop constraint "change_scope_check",
  add constraint "change_scope_check" check ("scope" in ('platform', 'tenant', 'group', 'account')),
  add constraint "change_account_check" check ("scope" <> 'account' or ("tenant_id" is null and "scope_id" = "requester_id" and "route" = 'none'));
`,
  },
]

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/

export function quoteSchema(schema: string): string {
  if (!SCHEMA_PATTERN.test(schema)) throw new TypeError(`Invalid configuration schema name '${schema}'.`)
  return `"${schema}"`
}

interface Client {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  release(): void
}

/**
 * Applies pending migrations in order, once, serialised across instances by a
 * transaction-scoped advisory lock. With `runtimeRole`, grants that role data
 * access only: it owns nothing and never alters the schema.
 */
export async function runConfigurationMigrations(pool: PostgresPoolLike, schema: string, runtimeRole?: string): Promise<string[]> {
  const quoted = quoteSchema(schema)
  if (runtimeRole !== undefined && !SCHEMA_PATTERN.test(runtimeRole)) throw new TypeError(`Invalid runtime role name '${runtimeRole}'.`)
  const client = await pool.connect() as Client
  const applied: string[] = []
  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`configuration-migrations:${schema}`])
    await client.query(`create schema if not exists ${quoted}`)
    await client.query(`create table if not exists ${quoted}."migration" ("id" text primary key, "applied_at" timestamptz not null default now())`)
    const { rows } = await client.query(`select "id" from ${quoted}."migration"`)
    const done = new Set(rows.map(row => row.id as string))
    for (const migration of CONFIGURATION_MIGRATIONS) {
      if (done.has(migration.id)) continue
      await client.query(migration.sql.replaceAll('{{schema}}', quoted))
      await client.query(`insert into ${quoted}."migration" ("id") values ($1)`, [migration.id])
      applied.push(migration.id)
    }
    if (runtimeRole !== undefined) {
      const role = `"${runtimeRole}"`
      await client.query(`grant usage on schema ${quoted} to ${role}`)
      await client.query(`grant select, insert, update, delete on ${quoted}."value", ${quoted}."change", ${quoted}."approval", ${quoted}."history", ${quoted}."outbox" to ${role}`)
      await client.query(`grant usage on sequence ${quoted}."history_sequence_seq", ${quoted}."outbox_sequence_seq" to ${role}`)
      await client.query(`grant select, insert, update on ${quoted}."tenant", ${quoted}."processed_event" to ${role}`)
    }
    await client.query('commit')
    return applied
  }
  catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  }
  finally {
    client.release()
  }
}
