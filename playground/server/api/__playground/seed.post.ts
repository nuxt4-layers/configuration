import { createError, defineEventHandler } from 'h3'
import { id } from '../../../../tests/support/world'
import { pool, testMode, world } from '../../plugins/composition'

/**
 * Browser tests only: a tenant answering on `localhost`, its root group and a
 * team, a manager (Alice), a second manager who approves (Bob) and a member
 * who may only read (Carol). Alice has her own account.
 */
export default defineEventHandler(async () => {
  if (!testMode || !pool) throw createError({ statusCode: 404 })
  await pool.query('truncate "configuration"."value", "configuration"."change", "configuration"."approval", "configuration"."history", "configuration"."outbox"')
  const tenantId = world.tenant()
  const rootGroup = world.group(tenantId)
  const team = world.group(tenantId, rootGroup)
  const [alice, bob, carol] = [id(), id(), id()]
  for (const person of [alice, bob]) {
    world.grant(person, 'configuration.group-settings:manage', team)
    world.grant(person, 'configuration.settings:view', team)
    world.join(person, team)
  }
  world.join(carol, team)
  world.account(alice, tenantId)
  await pool.query(`insert into "configuration"."value" ("scope", "scope_id", "tenant_id", "key", "value", "change_id", "updated_at") values ('tenant', $1, $1, 'site.host-names', '["localhost"]', $2, now())`, [tenantId, id()])
  return { tenantId, rootGroup, team, alice, bob, carol }
})
