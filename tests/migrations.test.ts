import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runConfigurationMigrations } from '../server/database/migrations'
import { createTestDatabase, hasDatabase, requireDatabaseInCi } from './support/database'

requireDatabaseInCi()

describe.skipIf(!hasDatabase)('Migrations (PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>
  let admin: pg.Pool
  const role = `configuration_runtime_${randomBytes(4).toString('hex')}`
  const password = randomBytes(12).toString('hex')

  beforeAll(async () => {
    database = await createTestDatabase()
    admin = new pg.Pool({ connectionString: database.url, max: 2 })
    await admin.query(`create role "${role}" login password '${password}'`)
  })

  afterAll(async () => {
    await admin?.end()
    await database?.drop()
    const cleanup = new pg.Client({ connectionString: process.env.CONFIGURATION_TEST_DATABASE_URL })
    await cleanup.connect()
    await cleanup.query(`drop role if exists "${role}"`)
    await cleanup.end()
  })

  it('applies each migration once', async () => {
    expect(await runConfigurationMigrations(admin, 'configuration', role)).toEqual(['0001_values_changes_history_outbox', '0002_host_names', '0003_identity_events', '0004_account_scope'])
    expect(await runConfigurationMigrations(admin, 'configuration', role)).toEqual([])
  })

  it('gives the runtime role data access only: it owns nothing and alters nothing', async () => {
    const url = new URL(database.url)
    url.username = role
    url.password = password
    const runtime = new pg.Client({ connectionString: url.toString() })
    await runtime.connect()
    try {
      await runtime.query(`insert into "configuration"."outbox" ("event", "created_at") values ('{}', now())`)
      await expect(runtime.query(`create table "configuration"."x" ("y" int)`)).rejects.toThrow(/permission denied/)
      await expect(runtime.query(`alter table "configuration"."value" add column "z" int`)).rejects.toThrow(/must be owner/)
      await expect(runtime.query(`delete from "configuration"."migration"`)).rejects.toThrow(/permission denied/)
    }
    finally {
      await runtime.end()
    }
  })
})
