import { createHash } from 'node:crypto'
import { z } from 'zod'
import type {
  ConfigurationAccessDecision,
  ConfigurationCatalogue,
  ConfigurationChange,
  ConfigurationChangeRoute,
  ConfigurationChangeStatus,
  ConfigurationChangeTarget,
  ConfigurationClock,
  ConfigurationConflictReason,
  ConfigurationDirectory,
  ConfigurationEvent,
  ConfigurationGovernance,
  ConfigurationGovernedGroup,
  ConfigurationPermission,
  ConfigurationProvenance,
  ConfigurationRisk,
  ConfigurationScopeKind,
  ConfigurationSubject,
  ConfigurationTenants,
  ConfigurationValues,
  ConfigurationVisibility,
  PostgresPoolLike,
} from '../../shared/contracts'
import {
  canonicalJson,
  configurationChangeRequestSchema,
  configurationEventSchema,
  ConfigurationFailure,
  correlationIdSchema,
  decisionSchema,
  digestSchema,
  highestRisk,
  identifierSchema,
  MANAGE_PERMISSION,
  meetsStepUp,
  readPermission,
  requiredApprovals,
  resolveConfiguration,
  riskRank,
  SCOPE_RISK_FLOOR,
  subjectSchema,
  VIEW_PERMISSION,
} from '../../shared/contracts'
import { quoteSchema } from '../database/migrations'

/** Identity's events this layer consumes (Identity contract §11), checked strictly. */
const IDENTITY_EVENT_TYPES = ['tenant.created', 'tenant.closing', 'tenant.closing-cancelled', 'tenant.closed', 'tenant.disposal-due', 'group.deleted', 'group.disposal-due', 'identity.closed'] as const
const envelope = { eventId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), occurredAt: z.string(), correlationId: correlationIdSchema }
const identityEventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.enum(['tenant.created', 'tenant.closing', 'tenant.closing-cancelled', 'tenant.disposal-due']), data: z.object({ tenantId: identifierSchema }) }),
  z.object({ ...envelope, type: z.literal('tenant.closed'), data: z.object({ tenantId: identifierSchema, disposal: z.enum(['due', 'deferred']) }) }),
  z.object({ ...envelope, type: z.literal('group.deleted'), data: z.object({ groupId: identifierSchema, tenantId: identifierSchema, disposal: z.enum(['due', 'deferred']) }) }),
  z.object({ ...envelope, type: z.literal('group.disposal-due'), data: z.object({ groupId: identifierSchema, tenantId: identifierSchema }) }),
  z.object({ ...envelope, type: z.literal('identity.closed'), data: z.object({ identityId: identifierSchema }) }),
])
const tenantSyncSchema = z.array(z.strictObject({ tenantId: identifierSchema, state: z.enum(['active', 'closing', 'closed']) })).max(10_000)
import { timeFrom, uuidv7 } from './clock'

/**
 * PRIVATE. Configuration's core (docs/contracts.md): resolution, pending
 * changes with approvals, history, the outbox, maintenance and disposal.
 */

interface Client {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[], rowCount: number | null }>
  release(): void
}

export interface ServiceDependencies {
  pool: PostgresPoolLike
  schema: string
  catalogue: () => ConfigurationCatalogue
  /** The deployment's values, already parsed against the catalogue. */
  deployment: () => ConfigurationValues
  directory: () => ConfigurationDirectory
  /** The host's tenants port; without one (`null`), the states Identity's events announced (§4). */
  tenants: () => ConfigurationTenants | null
  governance: () => ConfigurationGovernance
  access: () => ConfigurationAccessDecision
  platformGroupId: () => string
  clock: () => ConfigurationClock
  /** How long history of possibly-personal keys and decided changes are kept. */
  retentionDays?: number
}

const DAY = 86_400_000
const HOUR = 3_600_000
const OPEN: readonly ConfigurationChangeStatus[] = ['awaiting', 'delayed']

/** SHA-256 of a value's canonical JSON; `null` for no value. */
export function valueDigest(value: unknown): string | null {
  return value === undefined ? null : createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function parse<T>(run: () => T): T {
  try {
    return run()
  }
  catch (error) {
    const issues = (error as { issues?: { message: string }[] }).issues
    throw new ConfigurationFailure('validation-failed', issues?.[0]?.message ?? 'invalid-input')
  }
}

/** Calls a port; anything but a contract failure becomes `unavailable`. */
async function port<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  }
  catch (error) {
    if (error instanceof ConfigurationFailure) throw error
    throw new ConfigurationFailure('unavailable', 'port-failed')
  }
}

interface ScopeRow { scope: ConfigurationScopeKind, scopeId: string, tenantId: string | null }

interface ChangeRow {
  change_id: string
  scope: ConfigurationScopeKind
  scope_id: string
  tenant_id: string | null
  governing_group_id: string
  requester_id: string
  controlled_ids: string[]
  risk: ConfigurationRisk
  route: ConfigurationChangeRoute
  required_approvals: number
  group_requirement: number
  owner_group_id: string | null
  set: Record<string, unknown>
  expected: Record<string, string | null>
  justification: { reasonCode: string, reference?: string }
  digest: string
  status: ConfigurationChangeStatus
  reason_code: string | null
  requested_at: Date
  expires_at: Date | null
  applies_at: Date | null
  held_until: Date | null
  decided_at: Date | null
  correlation_id: string
}

function targetOf(row: Pick<ChangeRow, 'scope' | 'scope_id' | 'tenant_id' | 'governing_group_id'>): ConfigurationChangeTarget {
  if (row.scope === 'platform') return { scope: 'platform' }
  if (row.scope === 'tenant') return { scope: 'tenant', tenantId: row.scope_id, governingGroupId: row.governing_group_id }
  if (row.scope === 'account') return { scope: 'account' }
  return { scope: 'group', groupId: row.scope_id }
}

/** The permission a scope's changes need; none for an account, which only its person changes. */
function managePermission(scope: ConfigurationScopeKind): ConfigurationPermission | null {
  return scope === 'account' ? null : MANAGE_PERMISSION[scope]
}

type DisposalReason = 'group-disposed' | 'tenant-disposed' | 'account-closed'

/** The digest of everything a change will do and how it was routed (§7.3). */
function changeDigest(row: Pick<ChangeRow, 'scope' | 'scope_id' | 'tenant_id' | 'governing_group_id' | 'requester_id' | 'risk' | 'justification' | 'set' | 'expected' | 'required_approvals' | 'route' | 'group_requirement' | 'owner_group_id'>): string {
  return sha256(canonicalJson({
    target: targetOf(row),
    tenantId: row.tenant_id,
    governingGroupId: row.governing_group_id,
    requesterId: row.requester_id,
    risk: row.risk,
    justification: row.justification,
    set: row.set,
    expected: row.expected,
    requiredApprovals: row.required_approvals,
    route: row.route,
    groupRequirement: row.group_requirement,
    ownerGroupId: row.owner_group_id,
  }))
}

export function createConfigurationService(deps: ServiceDependencies) {
  const s = quoteSchema(deps.schema)
  const retentionDays = deps.retentionDays ?? 400
  const now = (): Date => timeFrom(deps.clock())

  async function transaction<T>(run: (client: Client) => Promise<T>): Promise<T> {
    let client: Client
    try {
      client = await deps.pool.connect() as Client
    }
    catch {
      throw new ConfigurationFailure('unavailable', 'database-connection-failed')
    }
    try {
      await client.query('begin')
      const result = await run(client)
      await client.query('commit')
      return result
    }
    catch (error) {
      await client.query('rollback').catch(() => {})
      if (error instanceof ConfigurationFailure) throw error
      throw new ConfigurationFailure('unavailable', 'database-failed')
    }
    finally {
      client.release()
    }
  }

  async function emit(client: Client, type: ConfigurationEvent['type'], data: unknown, correlationId: string, actorId: string | null): Promise<void> {
    const at = now()
    // Parsed strictly: an event can never carry a value.
    const event = configurationEventSchema.parse({ eventId: uuidv7(at.getTime()), type, occurredAt: at.toISOString(), correlationId, actorId, data })
    await client.query(`insert into ${s}."outbox" ("event", "created_at") values ($1::jsonb, $2)`, [JSON.stringify(event), at])
  }

  // ---------------------------------------------------------------- values

  /** Stored values of the given scopes, each parsed against the catalogue; anything it refuses is ignored. */
  async function storedValues(client: Pick<Client, 'query'>, scopes: readonly { scope: ConfigurationScopeKind, scopeId: string }[], lock = false): Promise<Map<string, Record<string, unknown>>> {
    const catalogue = deps.catalogue()
    const result = new Map<string, Record<string, unknown>>(scopes.map(entry => [`${entry.scope}:${entry.scopeId}`, {}]))
    if (scopes.length === 0) return result
    const { rows } = await client.query(
      `select "scope", "scope_id", "key", "value" from ${s}."value" where ("scope", "scope_id") in (select * from unnest($1::text[], $2::text[]))${lock ? ' for update' : ''}`,
      [scopes.map(entry => entry.scope), scopes.map(entry => entry.scopeId)],
    )
    for (const row of rows) {
      const declaration = catalogue.get(row.key as string)
      if (!declaration?.scopes.includes(row.scope as ConfigurationScopeKind)) continue
      const parsed = declaration.schema.safeParse(row.value)
      if (parsed.success) result.get(`${row.scope}:${row.scope_id}`)![row.key as string] = parsed.data
    }
    return result
  }

  async function query(text: string, values?: readonly unknown[]) {
    try {
      return await (deps.pool.query(text, values) as ReturnType<Client['query']>)
    }
    catch {
      throw new ConfigurationFailure('unavailable', 'database-failed')
    }
  }

  /**
   * The values in force for a tenant, a group and its lineage, or a
   * person's account and their home tenant, up to the visibility asked, with
   * provenance (§4). `null` when the tenant, group or account does not exist
   * or is closed or deleted, or the group is a personal group.
   */
  async function getConfiguration(input: { tenantId?: string, groupId?: string, accountId?: string, keys?: readonly string[], visibility: ConfigurationVisibility }) {
    const tenantId = input.tenantId === undefined ? undefined : parse(() => identifierSchema.parse(input.tenantId))
    const groupId = input.groupId === undefined ? undefined : parse(() => identifierSchema.parse(input.groupId))
    const accountId = input.accountId === undefined ? undefined : parse(() => identifierSchema.parse(input.accountId))
    if (accountId !== undefined && (groupId !== undefined || tenantId !== undefined)) throw new ConfigurationFailure('validation-failed', 'account-alone')
    let lineage: readonly string[] = []
    let tenant = tenantId
    if (accountId !== undefined) {
      const actor = await port(() => deps.directory().describeActor(accountId, { consistency: 'bounded' }))
      if (!actor || actor.kind !== 'person' || !actor.personalGroupId) return null
      const personal = await port(() => deps.directory().describeGroup(actor.personalGroupId!, { consistency: 'bounded' }))
      if (!personal || personal.kind !== 'personal' || personal.state === 'deleted') return null
      tenant = personal.tenantId
    }
    if (groupId !== undefined) {
      const group = await port(() => deps.directory().describeGroup(groupId, { consistency: 'bounded' }))
      if (!group || group.kind !== 'standard' || group.state === 'deleted') return null
      if (tenantId !== undefined && group.tenantId !== tenantId) return null
      tenant = group.tenantId
      lineage = [...group.lineage].reverse()
    }
    if (tenant !== undefined) {
      const facts = await port(() => tenantsPort().describeTenant(tenant!))
      if (!facts || facts.state === 'closed') return null
    }
    const scopes = [
      { scope: 'platform' as const, scopeId: '' },
      ...(tenant === undefined ? [] : [{ scope: 'tenant' as const, scopeId: tenant }]),
      ...lineage.map(id => ({ scope: 'group' as const, scopeId: id })),
      ...(accountId === undefined ? [] : [{ scope: 'account' as const, scopeId: accountId }]),
    ]
    const stored = await storedValues({ query }, scopes)
    return resolveConfiguration(deps.catalogue(), {
      deployment: deps.deployment(),
      platform: stored.get('platform:')!,
      tenant: tenant === undefined ? undefined : stored.get(`tenant:${tenant}`),
      account: accountId === undefined ? undefined : stored.get(`account:${accountId}`),
      lineage: lineage.map(id => ({ groupId: id, values: stored.get(`group:${id}`)! })),
    }, { keys: input.keys, visibility: input.visibility })
  }

  // ---------------------------------------------------------------- scopes

  interface Located extends ScopeRow {
    governingGroupId: string
    /** Why the scope takes no changes now, if it does not. */
    closed: ConfigurationConflictReason | null
  }

  /**
   * Finds a change target's scope and governing group (§7.1). Anything
   * unknown, closed or deleted is `forbidden`. An account is always the
   * subject's own, governed by their personal group.
   */
  async function locate(target: ConfigurationChangeTarget, subjectId: string): Promise<Located> {
    if (target.scope === 'account') {
      const actor = await port(() => deps.directory().describeActor(subjectId, { consistency: 'strong' }))
      if (!actor || actor.kind !== 'person' || !actor.personalGroupId) throw new ConfigurationFailure('forbidden')
      const group = await port(() => deps.directory().describeGroup(actor.personalGroupId!, { consistency: 'strong' }))
      if (!group || group.kind !== 'personal' || group.state === 'deleted') throw new ConfigurationFailure('forbidden')
      const tenant = await port(() => tenantsPort().describeTenant(group.tenantId))
      if (!tenant || tenant.state === 'closed') throw new ConfigurationFailure('forbidden')
      const closed = tenant.state === 'closing' ? 'scope-closing' : group.state === 'active' ? null : 'scope-read-only'
      return { scope: 'account', scopeId: subjectId, tenantId: null, governingGroupId: group.groupId, closed }
    }
    if (target.scope === 'platform') {
      const governingGroupId = deps.platformGroupId()
      return { scope: 'platform', scopeId: '', tenantId: null, governingGroupId, closed: null }
    }
    if (target.scope === 'group') {
      const group = await port(() => deps.directory().describeGroup(target.groupId, { consistency: 'strong' }))
      if (!group || group.kind !== 'standard' || group.state === 'deleted') throw new ConfigurationFailure('forbidden')
      const tenant = await port(() => tenantsPort().describeTenant(group.tenantId))
      if (!tenant || tenant.state === 'closed') throw new ConfigurationFailure('forbidden')
      const closed = tenant.state === 'closing' ? 'scope-closing' : group.state === 'active' ? null : 'scope-read-only'
      return { scope: 'group', scopeId: group.groupId, tenantId: group.tenantId, governingGroupId: group.groupId, closed }
    }
    const tenant = await port(() => tenantsPort().describeTenant(target.tenantId))
    if (!tenant || tenant.state === 'closed') throw new ConfigurationFailure('forbidden')
    return { scope: 'tenant', scopeId: target.tenantId, tenantId: target.tenantId, governingGroupId: target.governingGroupId, closed: tenant.state === 'closing' ? 'scope-closing' : null }
  }

  /** The governing group's facts; for a tenant, it must be a root group of that tenant. */
  async function governed(located: Located, identityId: string, correlationId: string): Promise<ConfigurationGovernedGroup | null> {
    const group = await port(() => deps.governance().describeGroup({ groupId: located.governingGroupId, identityId, correlationId }))
    if (!group || group.kind !== (located.scope === 'account' ? 'personal' : 'standard') || group.state === 'deleted') return null
    if (group.groupId !== located.governingGroupId) return null
    if (located.scope === 'tenant' && (group.tenantId !== located.tenantId || group.parentId !== null)) return null
    if (located.scope === 'group' && group.tenantId !== located.tenantId) return null
    return group
  }

  /** People only: refused when either Authentication's subject or Identity's directory says service. */
  async function requirePerson(subject: ConfigurationSubject): Promise<void> {
    if (subject.kind !== 'person') throw new ConfigurationFailure('forbidden')
    const actor = await port(() => deps.directory().describeActor(subject.identityId, { consistency: 'strong' }))
    if (!actor || actor.kind !== 'person') throw new ConfigurationFailure('forbidden')
  }

  async function allows(identityId: string, permission: string, groupId: string): Promise<boolean> {
    return port(() => deps.access().allows({ identityId, permission, groupId, consistency: 'strong' }))
  }

  /** Each key's checks against the catalogue: declared, settable at the scope, not locked, a valid value. */
  function checkKeys(scope: ConfigurationScopeKind, set: Record<string, unknown>): { set: Record<string, unknown>, risks: ConfigurationRisk[], problem: string | null } {
    const catalogue = deps.catalogue()
    const parsed: Record<string, unknown> = {}
    const risks: ConfigurationRisk[] = []
    for (const [key, value] of Object.entries(set)) {
      const declaration = catalogue.get(key)
      if (!declaration) return { set: parsed, risks, problem: 'unknown-setting' }
      if (!declaration.scopes.includes(scope)) return { set: parsed, risks, problem: 'not-settable-here' }
      if (declaration.locked) return { set: parsed, risks, problem: 'locked-setting' }
      if (value === null) parsed[key] = null
      else {
        const result = declaration.schema.safeParse(value)
        if (!result.success) return { set: parsed, risks, problem: result.error.issues[0]?.message ?? 'invalid-value' }
        parsed[key] = result.data
      }
      risks.push(declaration.risk)
    }
    return { set: parsed, risks, problem: null }
  }

  async function lockScope(client: Client, scope: ConfigurationScopeKind, scopeId: string): Promise<void> {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`configuration:${scope}:${scopeId}`])
  }

  async function valuesChanged(client: Client, scope: ConfigurationScopeKind, scopeId: string, expected: Record<string, string | null>): Promise<boolean> {
    const { rows } = await client.query(`select "key", "value" from ${s}."value" where "scope" = $1 and "scope_id" = $2 and "key" = any($3::text[])`, [scope, scopeId, Object.keys(expected)])
    const current = new Map(rows.map(row => [row.key as string, valueDigest(row.value)]))
    return Object.entries(expected).some(([key, digest]) => (current.get(key) ?? null) !== digest)
  }

  const HOST_NAMES = 'site.host-names'

  /** Whether another tenant already answers on any of these host names. Serialised by an advisory lock. */
  async function hostTaken(client: Client, tenantId: string, names: unknown): Promise<boolean> {
    if (!Array.isArray(names)) return false
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['configuration:host-names'])
    const { rows } = await client.query(
      `select 1 from ${s}."value" where "scope" = 'tenant' and "key" = $1 and "scope_id" <> $2 and "value" ?| $3::text[] limit 1`,
      [HOST_NAMES, tenantId, names],
    )
    return rows.length > 0
  }

  /** The tenant a request's host name resolves to, or `null` (platform values only). */
  async function tenantForHost(host: string): Promise<string | null> {
    const name = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
    if (!/^[a-z0-9.-]{1,253}$/.test(name)) return null
    const { rows } = await query(`select "scope_id" from ${s}."value" where "scope" = 'tenant' and "key" = $1 and "value" @> $2::jsonb limit 1`, [HOST_NAMES, JSON.stringify([name])])
    return (rows[0]?.scope_id as string | undefined) ?? null
  }

  /**
   * The values a viewer may read (§5). Anonymous viewers get `public`
   * platform and tenant values, never a group's. A signed-in viewer gets
   * `members` values of a tenant they are a member of; for a group of the
   * request's tenant, `members` values as its member or with
   * `configuration.settings:view` on it, `public` ones as a member of the
   * tenant, otherwise `forbidden`. With `account`, a person's own account
   * and home tenant, `members` values included; nobody else's.
   */
  async function readForViewer(input: { subject: ConfigurationSubject | null, tenantId: string | null, groupId?: string, account?: boolean }) {
    const tenantId = input.tenantId ?? undefined
    if (!input.subject) {
      if (input.groupId !== undefined || input.account) throw new ConfigurationFailure('unauthenticated')
      return getConfiguration({ tenantId, visibility: 'public' })
    }
    const subject = parse(() => subjectSchema.parse(input.subject)) as ConfigurationSubject
    if (input.account) {
      if (input.groupId !== undefined) throw new ConfigurationFailure('validation-failed', 'account-alone')
      const answer = subject.kind === 'person' ? await getConfiguration({ accountId: subject.identityId, visibility: 'members' }) : null
      if (!answer) throw new ConfigurationFailure('forbidden')
      return answer
    }
    const actor = await port(() => deps.directory().describeActor(subject.identityId, { consistency: 'bounded' }))
    const memberships = actor?.memberships ?? []
    const memberOfTenant = tenantId === undefined || memberships.some(membership => membership.tenantId === tenantId)
    if (input.groupId === undefined) return getConfiguration({ tenantId, visibility: memberOfTenant ? 'members' : 'public' })
    const groupId = parse(() => identifierSchema.parse(input.groupId))
    const group = await port(() => deps.directory().describeGroup(groupId, { consistency: 'bounded' }))
    if (!group || group.kind !== 'standard' || group.state === 'deleted' || (tenantId !== undefined && group.tenantId !== tenantId)) throw new ConfigurationFailure('forbidden')
    const visibility: ConfigurationVisibility | null = memberships.some(membership => membership.groupId === groupId) || await port(() => deps.access().allows({ identityId: subject.identityId, permission: VIEW_PERMISSION, groupId, consistency: 'bounded' }))
      ? 'members'
      : memberships.some(membership => membership.tenantId === group.tenantId) ? 'public' : null
    if (!visibility) throw new ConfigurationFailure('forbidden')
    const answer = await getConfiguration({ groupId, visibility })
    if (!answer) throw new ConfigurationFailure('forbidden')
    return answer
  }

  /**
   * Over HTTP, a request on a tenant's host name reaches only that tenant's
   * scopes and changes (and the platform's). On a host name no tenant claims
   * (`null`: the platform's own) and from server code (`undefined`), only
   * Authorisation's decisions limit what a subject reaches.
   */
  function confine(scopeTenantId: string | null, requestTenantId: string | null | undefined): void {
    if (requestTenantId == null || scopeTenantId === null) return
    if (scopeTenantId !== requestTenantId) throw new ConfigurationFailure('forbidden')
  }

  /**
   * The read permission (`readPermission`) on the scope's governing group,
   * which must govern it (§7.1). An account only for its own person.
   */
  async function requireViewer(located: Located, subject: ConfigurationSubject): Promise<void> {
    if (located.scope === 'account') {
      if (located.scopeId !== subject.identityId) throw new ConfigurationFailure('forbidden')
      return requirePerson(subject)
    }
    if (located.scope === 'tenant' && !await governed(located, subject.identityId, uuidv7(now().getTime()))) throw new ConfigurationFailure('forbidden')
    if (!await allows(subject.identityId, readPermission(located.scope), located.governingGroupId)) throw new ConfigurationFailure('forbidden')
  }

  /** Where a value set at the located scope comes from, for provenance. */
  function provenanceAt(located: Located): ConfigurationProvenance {
    return located.scope === 'group' ? { source: 'group', groupId: located.scopeId } : { source: located.scope }
  }

  // ---------------------------------------------------------------- changes

  function view(row: ChangeRow, approvals: { approver_id: string, decision: 'approve' | 'reject', decided_at: Date }[]): ConfigurationChange {
    return {
      changeId: row.change_id,
      target: targetOf(row),
      governingGroupId: row.governing_group_id,
      tenantId: row.tenant_id,
      requesterId: row.requester_id,
      risk: row.risk,
      route: row.route,
      requiredApprovals: row.required_approvals,
      ownerGroupId: row.owner_group_id,
      keys: Object.keys(row.set),
      set: row.set,
      justification: row.justification,
      digest: row.digest,
      status: row.status,
      reasonCode: row.reason_code,
      requestedAt: row.requested_at.toISOString(),
      expiresAt: row.expires_at?.toISOString() ?? null,
      appliesAt: row.applies_at?.toISOString() ?? null,
      heldUntil: row.held_until?.toISOString() ?? null,
      decidedAt: row.decided_at?.toISOString() ?? null,
      approvals: approvals.map(approval => ({ approverId: approval.approver_id, decision: approval.decision, decidedAt: approval.decided_at.toISOString() })),
      correlationId: row.correlation_id,
    }
  }

  async function loadChange(client: Pick<Client, 'query'>, changeId: string, lock = false): Promise<ChangeRow | null> {
    const { rows } = await client.query(`select * from ${s}."change" where "change_id" = $1${lock ? ' for update' : ''}`, [changeId])
    return (rows[0] as unknown as ChangeRow | undefined) ?? null
  }

  async function loadApprovals(client: Pick<Client, 'query'>, changeId: string) {
    const { rows } = await client.query(`select "approver_id", "decision", "decided_at" from ${s}."approval" where "change_id" = $1 order by "decided_at", "approver_id"`, [changeId])
    return rows as unknown as { approver_id: string, decision: 'approve' | 'reject', decided_at: Date }[]
  }

  async function finish(client: Client, row: ChangeRow, status: ConfigurationChangeStatus, reasonCode: ConfigurationConflictReason | DisposalReason | null, at: Date, actorId: string | null): Promise<void> {
    await client.query(`update ${s}."change" set "status" = $2, "reason_code" = $3, "decided_at" = $4 where "change_id" = $1`, [row.change_id, status, reasonCode, at])
    const approvers = (await loadApprovals(client, row.change_id)).filter(approval => approval.decision === 'approve').map(approval => approval.approver_id)
    await emit(client, 'configuration.change-decided', { changeId: row.change_id, outcome: status, approverIds: approvers, reasonCode }, row.correlation_id, actorId)
    row.status = status
    row.reason_code = reasonCode
    row.decided_at = at
  }

  /**
   * Applies a change after checking every rule again (§7.5), in the caller's
   * transaction. A rule that no longer holds rejects the change; a port
   * failure throws, so nothing is recorded and the change stays open.
   */
  async function apply(client: Client, row: ChangeRow, actorId: string | null): Promise<void> {
    const at = now()
    const reject = (reason: ConfigurationConflictReason) => finish(client, row, 'rejected', reason, at, actorId)
    if (changeDigest(row) !== row.digest) return reject('change-differs')
    let located: Located
    try {
      located = await locate(targetOf(row), row.requester_id)
    }
    catch (error) {
      if (error instanceof ConfigurationFailure && error.code === 'forbidden') return reject('not-governing')
      throw error
    }
    if (located.closed) return reject(located.closed)
    if (located.scopeId !== row.scope_id || located.governingGroupId !== row.governing_group_id) return reject('not-governing')
    const group = await governed(located, row.requester_id, row.correlation_id)
    if (!group) return reject('not-governing')
    const permission = managePermission(row.scope)
    if (permission && group.approvalsRequired[row.risk] > row.group_requirement) return reject('requirement-raised')
    if (permission && !await allows(row.requester_id, permission, row.governing_group_id)) return reject('permission-lost')
    const checked = checkKeys(row.scope, row.set)
    if (checked.problem || canonicalJson(checked.set) !== canonicalJson(row.set)) return reject('setting-changed')
    const risk = highestRisk([...checked.risks, ...permission ? [await port(() => deps.access().riskOf(permission))] : [], SCOPE_RISK_FLOOR[row.scope]])
    if (riskRank(risk) > riskRank(row.risk)) return reject('risk-raised')
    await lockScope(client, row.scope, row.scope_id)
    if (await valuesChanged(client, row.scope, row.scope_id, row.expected)) return reject('values-changed')
    if (row.tenant_id && await hostTaken(client, row.tenant_id, row.set[HOST_NAMES])) return reject('host-taken')

    const catalogue = deps.catalogue()
    const previous = await storedValues(client, [{ scope: row.scope, scopeId: row.scope_id }], true)
    const before = previous.get(`${row.scope}:${row.scope_id}`)!
    for (const [key, value] of Object.entries(row.set)) {
      if (value === null) await client.query(`delete from ${s}."value" where "scope" = $1 and "scope_id" = $2 and "key" = $3`, [row.scope, row.scope_id, key])
      else {
        await client.query(
          `insert into ${s}."value" ("scope", "scope_id", "tenant_id", "key", "value", "change_id", "updated_at") values ($1, $2, $3, $4, $5::jsonb, $6, $7)
           on conflict ("scope", "scope_id", "key") do update set "value" = excluded."value", "change_id" = excluded."change_id", "updated_at" = excluded."updated_at"`,
          [row.scope, row.scope_id, row.tenant_id, key, JSON.stringify(value), row.change_id, at],
        )
      }
      await client.query(
        `insert into ${s}."history" ("change_id", "scope", "scope_id", "tenant_id", "key", "previous", "next", "possibly_personal", "applied_at") values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
        [row.change_id, row.scope, row.scope_id, row.tenant_id, key, before[key] === undefined ? null : JSON.stringify(before[key]), value === null ? null : JSON.stringify(value), catalogue.get(key)!.sensitivity === 'possibly-personal', at],
      )
    }
    await finish(client, row, 'applied', null, at, actorId)
    await emit(client, 'configuration.changed', { scope: row.scope, scopeId: row.scope_id || null, keys: Object.keys(row.set), changeId: row.change_id }, row.correlation_id, actorId)
  }

  /** Applies now, or waits as `delayed` until a recovery hold ends. */
  async function applyOrHold(client: Client, row: ChangeRow, actorId: string | null): Promise<void> {
    const at = now()
    if (row.held_until && row.held_until > at) {
      await client.query(`update ${s}."change" set "status" = 'delayed', "applies_at" = $2 where "change_id" = $1`, [row.change_id, row.held_until])
      row.status = 'delayed'
      row.applies_at = row.held_until
      return
    }
    await apply(client, row, actorId)
  }

  /** §6: requests a change; it applies at once when no approver is needed. */
  async function request(input: { subject: ConfigurationSubject, request: unknown, correlationId: string, tenantId?: string | null }): Promise<ConfigurationChange> {
    const subject = parse(() => subjectSchema.parse(input.subject)) as ConfigurationSubject
    const correlationId = parse(() => correlationIdSchema.parse(input.correlationId))
    const requested = parse(() => configurationChangeRequestSchema.parse(input.request))
    const checked = checkKeys(requested.target.scope, requested.set)
    if (checked.problem) throw new ConfigurationFailure('validation-failed', checked.problem)

    const located = await locate(requested.target, subject.identityId)
    confine(located.tenantId, input.tenantId)
    await requirePerson(subject)
    const group = await governed(located, subject.identityId, correlationId)
    if (!group) throw new ConfigurationFailure('forbidden')
    const permission = managePermission(located.scope)
    if (permission && !await allows(subject.identityId, permission, located.governingGroupId)) throw new ConfigurationFailure('forbidden')
    if (located.closed) throw new ConfigurationFailure('conflict', located.closed)
    if (group.referenceRequired && !requested.justification.reference) throw new ConfigurationFailure('validation-failed', 'reference-missing')

    const risk = highestRisk([...checked.risks, ...permission ? [await port(() => deps.access().riskOf(permission))] : [], SCOPE_RISK_FLOOR[located.scope]])
    const at = now()
    if (!meetsStepUp(risk, subject.assurance, at)) throw new ConfigurationFailure('insufficient-assurance')

    // Requirement and route (§7.2). In their own account a person needs no
    // approver, but still steps up and waits out a recovery hold.
    const groupRequirement = permission ? group.approvalsRequired[risk] : 0
    let required = permission ? requiredApprovals(risk, groupRequirement) : 0
    const excluding = [subject.identityId, ...group.controlledIdentityIds]
    let route: ConfigurationChangeRoute = 'none'
    let ownerGroupId: string | null = null
    if (required > 0) {
      if (await port(() => deps.access().countQualifying({ permission: permission!, groupId: located.governingGroupId, excluding })) >= required) route = 'approvers'
      else if (group.parentId && await port(() => deps.governance().countOwners({ groupId: group.parentId!, excluding })) >= 1) {
        route = 'parent-owner'
        ownerGroupId = group.parentId
        required = 1
      }
      else if (group.rootId !== located.governingGroupId && group.rootId !== group.parentId && await port(() => deps.governance().countOwners({ groupId: group.rootId, excluding })) >= 1) {
        route = 'tenant-owner'
        ownerGroupId = group.rootId
        required = 1
      }
      else route = 'published-delay'
    }
    const hold = group.recoveryHoldEndsAt ? new Date(group.recoveryHoldEndsAt) : null
    const heldUntil = hold && hold > at ? hold : null
    const delayHours = risk === 'critical' ? group.safetyPeriods.publishedDelayCriticalHours : group.safetyPeriods.publishedDelayHighHours
    const delayEnds = new Date(at.getTime() + delayHours * HOUR)

    const row: ChangeRow = {
      change_id: uuidv7(at.getTime()),
      scope: located.scope,
      scope_id: located.scopeId,
      tenant_id: located.tenantId,
      governing_group_id: located.governingGroupId,
      requester_id: subject.identityId,
      controlled_ids: [...group.controlledIdentityIds],
      risk,
      route,
      required_approvals: route === 'none' || route === 'published-delay' ? 0 : required,
      group_requirement: groupRequirement,
      owner_group_id: ownerGroupId,
      set: checked.set,
      expected: Object.fromEntries(Object.keys(checked.set).map(key => [key, requested.expected[key] ?? null])),
      justification: requested.justification,
      digest: '',
      status: route === 'published-delay' ? 'delayed' : 'awaiting',
      reason_code: null,
      requested_at: at,
      expires_at: route === 'approvers' || route === 'parent-owner' || route === 'tenant-owner' ? new Date(at.getTime() + group.safetyPeriods.approvalExpiryDays * DAY) : null,
      applies_at: route === 'published-delay' ? new Date(Math.max(delayEnds.getTime(), heldUntil?.getTime() ?? 0)) : null,
      held_until: heldUntil,
      decided_at: null,
      correlation_id: correlationId,
    }
    row.digest = changeDigest(row)

    return transaction(async (client) => {
      await lockScope(client, row.scope, row.scope_id)
      if (await valuesChanged(client, row.scope, row.scope_id, row.expected)) throw new ConfigurationFailure('conflict', 'values-changed')
      if (row.tenant_id && await hostTaken(client, row.tenant_id, row.set[HOST_NAMES])) throw new ConfigurationFailure('conflict', 'host-taken')
      await client.query(
        `insert into ${s}."change" ("change_id", "scope", "scope_id", "tenant_id", "governing_group_id", "requester_id", "controlled_ids", "risk", "route", "required_approvals", "group_requirement", "owner_group_id", "set", "expected", "justification", "digest", "status", "requested_at", "expires_at", "applies_at", "held_until", "correlation_id")
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17, $18, $19, $20, $21, $22)`,
        [row.change_id, row.scope, row.scope_id, row.tenant_id, row.governing_group_id, row.requester_id, JSON.stringify(row.controlled_ids), row.risk, row.route, row.required_approvals, row.group_requirement, row.owner_group_id, JSON.stringify(row.set), JSON.stringify(row.expected), JSON.stringify(row.justification), row.digest, row.status, row.requested_at, row.expires_at, row.applies_at, row.held_until, row.correlation_id],
      )
      await emit(client, 'configuration.change-requested', {
        changeId: row.change_id,
        scope: row.scope,
        scopeId: row.scope_id || null,
        governingGroupId: row.governing_group_id,
        keys: Object.keys(row.set),
        risk,
        route,
        requiredApprovals: row.required_approvals,
        expiresAt: row.expires_at?.toISOString() ?? null,
        appliesAt: row.applies_at?.toISOString() ?? null,
      }, correlationId, subject.identityId)
      if (heldUntil) await emit(client, 'configuration.change-held', { changeId: row.change_id, heldUntil: heldUntil.toISOString() }, correlationId, subject.identityId)
      if (route === 'none') await applyOrHold(client, row, subject.identityId)
      return view(row, [])
    })
  }

  /** Whether the subject may decide the change now (§7.4). */
  async function mayDecide(row: ChangeRow, identityId: string): Promise<boolean> {
    const permission = managePermission(row.scope)
    if (!permission) return false
    if (row.route === 'approvers') return allows(identityId, permission, row.governing_group_id)
    if (row.owner_group_id) return port(() => deps.governance().isOwner({ identityId, groupId: row.owner_group_id! }))
    return false
  }

  /** §7.4: approves or rejects the change the approver was shown. */
  async function decide(input: { subject: ConfigurationSubject, changeId: string, changeDigest: string, decision: 'approve' | 'reject', correlationId: string, tenantId?: string | null }): Promise<ConfigurationChange> {
    const subject = parse(() => subjectSchema.parse(input.subject)) as ConfigurationSubject
    const changeId = parse(() => identifierSchema.parse(input.changeId))
    const shown = parse(() => digestSchema.parse(input.changeDigest))
    const decision = parse(() => decisionSchema.parse(input.decision))
    parse(() => correlationIdSchema.parse(input.correlationId))
    await requirePerson(subject)
    return transaction(async (client) => {
      const row = await loadChange(client, changeId, true)
      if (!row) throw new ConfigurationFailure('forbidden')
      confine(row.tenant_id, input.tenantId)
      const isRequester = row.requester_id === subject.identityId
      if (!isRequester && !await mayDecide(row, subject.identityId)) throw new ConfigurationFailure('forbidden')
      if (isRequester) throw new ConfigurationFailure('conflict', 'own-request')
      if (row.controlled_ids.includes(subject.identityId)) throw new ConfigurationFailure('conflict', 'controlled-identity')
      if (row.status !== 'awaiting' || row.route === 'none' || row.route === 'published-delay') throw new ConfigurationFailure('conflict', 'not-open')
      const approvals = await loadApprovals(client, row.change_id)
      if (approvals.some(approval => approval.approver_id === subject.identityId)) throw new ConfigurationFailure('conflict', 'already-decided')
      if (shown !== row.digest || changeDigest(row) !== row.digest) throw new ConfigurationFailure('conflict', 'change-differs')
      const at = now()
      if (!meetsStepUp(row.risk, subject.assurance, at)) throw new ConfigurationFailure('insufficient-assurance')
      await client.query(
        `insert into ${s}."approval" ("change_id", "approver_id", "decision", "decided_at", "assurance", "digest") values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [row.change_id, subject.identityId, decision, at, JSON.stringify(subject.assurance), shown],
      )
      if (decision === 'reject') await finish(client, row, 'rejected', null, at, subject.identityId)
      else if (approvals.filter(approval => approval.decision === 'approve').length + 1 >= row.required_approvals) await applyOrHold(client, row, subject.identityId)
      return view(row, await loadApprovals(client, row.change_id))
    })
  }

  /** The requester cancels an open change; nobody else may. */
  async function cancel(input: { subject: ConfigurationSubject, changeId: string, correlationId: string, tenantId?: string | null }): Promise<ConfigurationChange> {
    const subject = parse(() => subjectSchema.parse(input.subject)) as ConfigurationSubject
    const changeId = parse(() => identifierSchema.parse(input.changeId))
    parse(() => correlationIdSchema.parse(input.correlationId))
    return transaction(async (client) => {
      const row = await loadChange(client, changeId, true)
      if (!row || row.requester_id !== subject.identityId) throw new ConfigurationFailure('forbidden')
      confine(row.tenant_id, input.tenantId)
      if (!OPEN.includes(row.status)) throw new ConfigurationFailure('conflict', 'not-open')
      await finish(client, row, 'cancelled', null, now(), subject.identityId)
      return view(row, await loadApprovals(client, row.change_id))
    })
  }

  /** §7.7: the requester, whoever may decide, and whoever may view the governing group's settings. */
  async function get(input: { subject: ConfigurationSubject, changeId: string, tenantId?: string | null }): Promise<ConfigurationChange> {
    const subject = parse(() => subjectSchema.parse(input.subject)) as ConfigurationSubject
    const changeId = parse(() => identifierSchema.parse(input.changeId))
    const row = await loadChange({ query }, changeId)
    if (!row) throw new ConfigurationFailure('forbidden')
    confine(row.tenant_id, input.tenantId)
    const may = row.requester_id === subject.identityId
      || (row.scope !== 'account' && (await allows(subject.identityId, readPermission(row.scope), row.governing_group_id)
        || (OPEN.includes(row.status) && await mayDecide(row, subject.identityId))))
    if (!may) throw new ConfigurationFailure('forbidden')
    return view(row, await loadApprovals({ query }, changeId))
  }

  /**
   * A scope as an administrator edits it: the values set there with their
   * digests (the `expected` of a request), the values in force, and its open
   * changes. Needs the read permission on the governing group; an account,
   * its own person.
   *
   * Only the scope's own settings (§5.1): the values in force cover the keys
   * the scope may set, and of those inherited from above only what the
   * scope's members may read, never a `server` value set elsewhere.
   */
  async function readScope(input: { subject: ConfigurationSubject, target: ConfigurationChangeTarget, tenantId?: string | null }) {
    const subject = parse(() => subjectSchema.parse(input.subject)) as ConfigurationSubject
    const located = await locate(input.target, subject.identityId)
    confine(located.tenantId, input.tenantId)
    await requireViewer(located, subject)
    const stored = (await storedValues({ query }, [{ scope: located.scope, scopeId: located.scopeId }])).get(`${located.scope}:${located.scopeId}`)!
    const declarations = describeDeclarations(located.scope)
    const where = located.scope === 'platform' ? {} : located.scope === 'tenant' ? { tenantId: located.scopeId } : located.scope === 'group' ? { groupId: located.scopeId } : { accountId: located.scopeId }
    const inForce = await getConfiguration({ ...where, keys: declarations.map(declaration => declaration.key), visibility: 'members' }) ?? { values: {}, provenance: {} }
    for (const [key, value] of Object.entries(stored)) {
      if (Object.hasOwn(inForce.values, key)) continue
      inForce.values[key] = value
      inForce.provenance[key] = provenanceAt(located)
    }
    const { rows } = await query(`select * from ${s}."change" where "scope" = $1 and "scope_id" = $2 and "status" in ('awaiting', 'delayed') order by "requested_at"`, [located.scope, located.scopeId])
    return {
      viewerId: subject.identityId,
      tenantId: located.tenantId,
      target: input.target,
      declarations,
      values: stored,
      digests: Object.fromEntries(Object.entries(stored).map(([key, value]) => [key, valueDigest(value)!])),
      inForce,
      openChanges: await Promise.all((rows as unknown as ChangeRow[]).map(async row => view(row, await loadApprovals({ query }, row.change_id)))),
      closed: located.closed,
    }
  }

  /**
   * The settings a scope may set, as a page needs them to build a form: each
   * value's JSON Schema (its refinements stay on the server, which checks
   * every value again).
   */
  function describeDeclarations(scope: ConfigurationScopeKind) {
    return [...deps.catalogue().values()].filter(declaration => declaration.scopes.includes(scope) && !declaration.locked).map(declaration => ({
      key: declaration.key,
      risk: declaration.risk,
      visibility: declaration.visibility,
      sensitivity: declaration.sensitivity,
      inherits: declaration.inherits ?? 'lineage',
      schema: z.toJSONSchema(declaration.schema, { io: 'input', unrepresentable: 'any' }),
    }))
  }

  /** §8: what applied changes did at a scope, newest first. */
  async function listHistory(input: { subject: ConfigurationSubject, target: ConfigurationChangeTarget, limit?: number, tenantId?: string | null }) {
    const subject = parse(() => subjectSchema.parse(input.subject)) as ConfigurationSubject
    const located = await locate(input.target, subject.identityId)
    confine(located.tenantId, input.tenantId)
    await requireViewer(located, subject)
    const { rows } = await query(`select "change_id", "key", "previous", "next", "applied_at" from ${s}."history" where "scope" = $1 and "scope_id" = $2 order by "sequence" desc limit $3`, [located.scope, located.scopeId, Math.min(Math.max(input.limit ?? 100, 1), 500)])
    return rows.map(row => ({ changeId: row.change_id as string, key: row.key as string, previous: row.previous, next: row.next, appliedAt: (row.applied_at as Date).toISOString() }))
  }

  // ------------------------------------------------------------ operations

  /** Expires, applies delayed and released changes (§7.6), and applies retention (§8). */
  async function runMaintenance(): Promise<{ expired: number, applied: number, rejected: number, retention: { history: number, changes: number } }> {
    const at = now()
    const result = { expired: 0, applied: 0, rejected: 0, retention: { history: 0, changes: 0 } }
    const { rows } = await query(`select "change_id" from ${s}."change" where ("status" = 'awaiting' and "expires_at" <= $1) or ("status" = 'delayed' and "applies_at" <= $1) order by "requested_at"`, [at])
    for (const { change_id: changeId } of rows) {
      await transaction(async (client) => {
        const row = await loadChange(client, changeId as string, true)
        if (!row) return
        if (row.status === 'awaiting' && row.expires_at && row.expires_at <= at) {
          await finish(client, row, 'expired', null, at, null)
          result.expired++
        }
        else if (row.status === 'delayed' && row.applies_at && row.applies_at <= at) {
          await apply(client, row, null)
          if ((row.status as ConfigurationChangeStatus) === 'applied') result.applied++
          else result.rejected++
        }
      })
    }
    await transaction(async (client) => {
      const cutoff = new Date(at.getTime() - retentionDays * DAY)
      result.retention.history = (await client.query(`delete from ${s}."history" where "possibly_personal" and "applied_at" < $1`, [cutoff])).rowCount ?? 0
      result.retention.changes = (await client.query(`delete from ${s}."change" where "status" not in ('awaiting', 'delayed') and "decided_at" < $1`, [cutoff])).rowCount ?? 0
      if (result.retention.history + result.retention.changes > 0) await emit(client, 'configuration.retention-applied', result.retention, uuidv7(at.getTime()), null)
    })
    return result
  }

  /** Publishes undelivered events in order, at least once. */
  async function relayOutbox(input: { publish: (event: ConfigurationEvent) => Promise<void>, limit?: number }): Promise<number> {
    return transaction(async (client) => {
      const { rows } = await client.query(`select "sequence", "event" from ${s}."outbox" where "published_at" is null order by "sequence" limit $1 for update skip locked`, [Math.min(Math.max(input.limit ?? 100, 1), 1000)])
      let published = 0
      for (const row of rows) {
        await port(() => input.publish(configurationEventSchema.parse(row.event)))
        await client.query(`update ${s}."outbox" set "published_at" = $2 where "sequence" = $1`, [row.sequence, now()])
        published++
      }
      return published
    })
  }

  async function dispose(where: string, id: string, scope: { scope: ConfigurationScopeKind, scopeId: string }, reasonCode: DisposalReason, correlationId: string): Promise<void> {
    await transaction(async (client) => {
      const at = now()
      const { rows } = await client.query(`select * from ${s}."change" where ${where} and "status" in ('awaiting', 'delayed') for update`, [id])
      for (const row of rows as unknown as ChangeRow[]) await finish(client, row, 'cancelled', reasonCode, at, null)
      await client.query(`delete from ${s}."value" where ${where}`, [id])
      await client.query(`delete from ${s}."history" where ${where}`, [id])
      await client.query(`delete from ${s}."change" where ${where}`, [id])
      await emit(client, 'configuration.reset', { scope: scope.scope, scopeId: scope.scopeId, reasonCode }, correlationId, null)
    })
  }

  /** A deleted group's part of its disposal (§14). */
  async function disposeGroup(input: { groupId: string, correlationId: string }): Promise<void> {
    const groupId = parse(() => identifierSchema.parse(input.groupId))
    const correlationId = parse(() => correlationIdSchema.parse(input.correlationId))
    await dispose(`"scope" = 'group' and "scope_id" = $1`, groupId, { scope: 'group', scopeId: groupId }, 'group-disposed', correlationId)
  }

  /** A tenant's part of its disposal: its values and every group's of it (§14). */
  async function disposeTenant(input: { tenantId: string, correlationId: string }): Promise<void> {
    const tenantId = parse(() => identifierSchema.parse(input.tenantId))
    const correlationId = parse(() => correlationIdSchema.parse(input.correlationId))
    await dispose(`"tenant_id" = $1`, tenantId, { scope: 'tenant', scopeId: tenantId }, 'tenant-disposed', correlationId)
  }

  /** A closed identity's account: its values, changes and history (§14). */
  async function disposeAccount(input: { identityId: string, correlationId: string }): Promise<void> {
    const identityId = parse(() => identifierSchema.parse(input.identityId))
    const correlationId = parse(() => correlationIdSchema.parse(input.correlationId))
    await dispose(`"scope" = 'account' and "scope_id" = $1`, identityId, { scope: 'account', scopeId: identityId }, 'account-closed', correlationId)
  }

  /** A person's part of a data-subject export: their account's values and history. */
  async function exportAccountData(input: { identityId: string }) {
    const identityId = parse(() => identifierSchema.parse(input.identityId))
    const values = await query(`select "key", "value", "updated_at" from ${s}."value" where "scope" = 'account' and "scope_id" = $1 order by "key"`, [identityId])
    const history = await query(`select "change_id", "key", "previous", "next", "applied_at" from ${s}."history" where "scope" = 'account' and "scope_id" = $1 order by "sequence"`, [identityId])
    return { identityId, values: values.rows, history: history.rows }
  }

  /** The tenant's part of a tenant export: its and its groups' values and history. */
  async function exportTenantData(input: { tenantId: string }) {
    const tenantId = parse(() => identifierSchema.parse(input.tenantId))
    const values = await query(`select "scope", "scope_id", "key", "value", "updated_at" from ${s}."value" where "tenant_id" = $1 order by "scope", "scope_id", "key"`, [tenantId])
    const history = await query(`select "change_id", "scope", "scope_id", "key", "previous", "next", "applied_at" from ${s}."history" where "tenant_id" = $1 order by "sequence"`, [tenantId])
    return { tenantId, values: values.rows, history: history.rows }
  }

  // ------------------------------------------------------------- Identity

  /** Tenant states as Identity's events announced them, when the host supplies no tenants port. */
  const projectedTenants: ConfigurationTenants = {
    async describeTenant(tenantId) {
      const { rows } = await query(`select "state" from ${s}."tenant" where "tenant_id" = $1`, [tenantId])
      const state = rows[0]?.state as 'active' | 'closing' | 'closed' | undefined
      return state ? { tenantId, state } : null
    },
  }

  function tenantsPort(): ConfigurationTenants {
    return deps.tenants() ?? projectedTenants
  }

  async function setTenant(client: Client, tenantId: string, state: 'active' | 'closing' | 'closed', at: Date): Promise<void> {
    await client.query(
      `insert into ${s}."tenant" ("tenant_id", "state", "updated_at") values ($1, $2, $3)
       on conflict ("tenant_id") do update set "state" = excluded."state", "updated_at" = excluded."updated_at"
       where ${s}."tenant"."state" <> 'closed'`,
      [tenantId, state, at],
    )
  }

  /**
   * Applies one of Identity's events (§14), idempotently by event id: tenant
   * states for the projection, and disposal of a group's or tenant's values
   * when Identity says it is due (never while a legal hold defers it).
   * Returns whether the event was new. Other events are ignored.
   */
  async function applyIdentityEvent(event: unknown): Promise<boolean> {
    const parsed = identityEventSchema.safeParse(event)
    if (!parsed.success) {
      if (event && typeof event === 'object' && typeof (event as { type?: unknown }).type === 'string' && !IDENTITY_EVENT_TYPES.includes((event as { type: string }).type as never)) return false
      throw new ConfigurationFailure('validation-failed', 'malformed-event')
    }
    const { eventId, type, correlationId, data } = parsed.data
    const at = now()
    const fresh = await transaction(async (client) => {
      const { rowCount } = await client.query(`insert into ${s}."processed_event" ("event_id", "processed_at") values ($1, $2) on conflict do nothing`, [eventId, at])
      if (!rowCount) return false
      if (type === 'tenant.created' || type === 'tenant.closing-cancelled') await setTenant(client, (data as { tenantId: string }).tenantId, 'active', at)
      else if (type === 'tenant.closing') await setTenant(client, (data as { tenantId: string }).tenantId, 'closing', at)
      else if (type === 'tenant.closed') await setTenant(client, (data as { tenantId: string }).tenantId, 'closed', at)
      return true
    })
    if (!fresh) return false
    const disposal = 'disposal' in data ? data.disposal : 'due'
    if ((type === 'group.deleted' && disposal === 'due') || type === 'group.disposal-due') await disposeGroup({ groupId: (data as { groupId: string }).groupId, correlationId })
    if ((type === 'tenant.closed' && disposal === 'due') || type === 'tenant.disposal-due') await disposeTenant({ tenantId: (data as { tenantId: string }).tenantId, correlationId })
    if (type === 'identity.closed') await disposeAccount({ identityId: (data as { identityId: string }).identityId, correlationId })
    return true
  }

  /**
   * Records tenants that existed before this layer was installed, which no
   * `tenant.created` event will announce. Server-only, for the operator.
   */
  async function syncTenants(tenants: readonly { tenantId: string, state: 'active' | 'closing' | 'closed' }[]): Promise<number> {
    const parsed = parse(() => tenantSyncSchema.parse(tenants))
    const at = now()
    return transaction(async (client) => {
      for (const tenant of parsed) await setTenant(client, tenant.tenantId, tenant.state, at)
      return parsed.length
    })
  }

  return {
    getConfiguration,
    applyIdentityEvent,
    syncTenants,
    tenantForHost,
    readForViewer,
    changes: { request, decide, cancel, get, readScope },
    listHistory,
    runMaintenance,
    relayOutbox,
    disposeGroup,
    disposeTenant,
    disposeAccount,
    exportTenantData,
    exportAccountData,
  }
}

export type ConfigurationService = ReturnType<typeof createConfigurationService>
