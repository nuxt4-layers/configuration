# Configuration Contract (version 1)

`@nuxt4-layers/configuration/contracts` is the only supported import path for this capability's types and pure helpers. It imports nothing but `zod`: no Nuxt, Vue, h3, server code, driver or other `@nuxt4-layers/*` package.

Configuration answers one question: **what does this site, this tenant or this group say about itself, now?** It holds organisational facts only. This is contract version 1 (§16): section numbers are stable, and the questions left open while it was drafted are decided in §17.

## 1. Boundaries

| Concern | Owner | How Configuration sees it |
|---|---|---|
| Site, organisation and group facts, presentation defaults | **Configuration** | Declared settings (§3), stored per scope (§4) |
| Tenants and their state | Identity | The tenant port (§11), by opaque identifier |
| Groups: kind, state, tenant and lineage | Identity | The directory port (§11), by opaque identifier |
| Group names and Identity's group settings (joining, guests, approvals, departure policy) | Identity | Never copied or overridden here |
| Approval requirements, safety periods, owners, recovery holds | Identity | The access-governance port (§11), for choosing an approval route (§7) |
| Personal data and personal preferences (locale, time zone, chosen theme) | Profile | Never. A setting that must name a person holds Identity's identifier, and pages show the name through Profile |
| Authentication, approval and access policy | Authentication, Identity, Authorisation | Never. A security setting belongs with the member it governs, under that member's controls |
| Who may request or approve a change | Authorisation | The access-decision port (§11) |
| Theme definitions | Theme Manager | Never. A setting may name a default theme by identifier; Theme Manager validates it |
| Secrets | The host's secret store | Never, under any visibility (§5) |
| Files | The host's asset store | A reference only (§3.2) |

## 2. What Configuration may hold

Values that describe the site, the organisation or a group: names, legal and registration details, addresses, organisational contact points, links, references to assets and defaults for presentation.

A setting is declared `possibly-personal` when its value can identify a person in some deployments (a sole trader's registered address, a named contact). Such a value never reaches an event, a log or an error; it is exported and disposed of with its tenant or group (§14); and its history is kept no longer than the retention period (§8).

## 3. Settings

### 3.1 Declarations

Nothing is stored unless a setting declares it. Each declaration is a strict object:

| Field | Meaning |
|---|---|
| `key` | `namespace.name`, lower-case ASCII with `-`, e.g. `organisation.legal-name`. The `site`, `organisation`, `contact`, `social`, `legal` and `seo` namespaces are the layer's; a host or another layer declares its own namespace |
| `schema` | A zod schema for the value. Strict objects only; every string bounded |
| `scopes` | Which scopes may set it: any of `platform`, `tenant` and `group` (§4) |
| `inherits` | For `group`: whether a group without its own value takes its nearest ancestor's (`lineage`, the default) or goes straight to the tenant (`none`) |
| `visibility` | `public`, `members` or `server` (§5) |
| `default` | The value when nothing sets it, parsed by `schema`; or none |
| `sensitivity` | `organisational` or `possibly-personal` (§2) |
| `risk` | `low`, `medium`, `high` or `critical`, in Authorisation's catalogue's sense: sets the approvals and step-up a change needs (§7) |
| `locked` | When `true`, only the deployment sets it (§4); nobody changes it at run time |

Declarations are registered once at start-up (`provideConfigurationCatalogue`). Two declarations of one key, a value stored for an undeclared key, or a declaration whose `default` its schema refuses, fail closed (`unavailable`), so a catalogue mistake is found at start-up rather than in a page. A declaration's `risk` may be raised in a later release; lowering it is a breaking change for that key.

### 3.2 The layer's own catalogue (version 1)

| Key | Value | Scopes | Visibility | Sensitivity | Risk |
|---|---|---|---|---|---|
| `site.name` | Safe text, 1 to 80 code points | platform, tenant | public | organisational | `medium` |
| `site.tagline` | Safe text, up to 160 | platform, tenant, group | public | organisational | `low` |
| `site.default-locale` | BCP 47 tag | platform, tenant | public | organisational | `medium` |
| `site.logo` | `{ assetId, alt }`: the host's asset reference and safe alternative text | platform, tenant, group | public | organisational | `medium` |
| `site.default-theme` | Theme identifier | platform, tenant, group | public | organisational | `low` |
| `organisation.legal-name` | Safe text, 1 to 200 | platform, tenant, group | public | organisational | `high` |
| `organisation.trading-name` | Safe text, up to 200 | platform, tenant, group | public | organisational | `medium` |
| `organisation.registration` | `{ jurisdiction, number }`, e.g. `GB` and a Companies House number | platform, tenant, group | public | organisational | `high` |
| `organisation.tax-number` | `{ scheme, number }`, e.g. `gb-vat` | platform, tenant, group | public | organisational | `high` |
| `organisation.registered-address` | Postal address (§3.3) | platform, tenant, group | public | possibly-personal | `high` |
| `organisation.postal-address` | Postal address (§3.3) | platform, tenant, group | public | possibly-personal | `medium` |
| `contact.general` | `{ email?, phone?, url? }`: an organisational mailbox, E.164 number or page | platform, tenant, group | public | possibly-personal | `medium` |
| `contact.data-protection` | As `contact.general`, plus an optional `identityId` shown through Profile | platform, tenant, group | public | possibly-personal | `high` |
| `contact.security` | Where vulnerabilities are reported, as a site's `security.txt` (RFC 9116) needs: `{ email?, phone?, url? }` (one at least), and optionally `policy`, `encryption` (an `https` key), `acknowledgements` and up to 10 `preferredLanguages`. Added in 1.2.0 | platform, tenant | public | possibly-personal | `high` |
| `social.links` | Up to 20 `{ network, url }`; `network` a registered code (`mastodon`, `linkedin`, `github`, …, `other`) | platform, tenant, group | public | organisational | `low` |
| `legal.links` | `{ privacy, terms, cookies, accessibility, modern-slavery? }`: each an `https` URL or a site-relative path | platform, tenant, group | public | organisational | `high` |
| `seo.description` | Safe text, up to 300 | platform, tenant, group | public | organisational | `low` |
| `seo.image` | `{ assetId, alt }` | platform, tenant, group | public | organisational | `low` |
| `seo.title-template` | Safe text containing `%s` once, up to 80 | platform, tenant | public | organisational | `low` |

`high` marks what a regulator, customer or court relies on: the legal entity, its registration and registered address, the legal pages and the data-protection contact. The security contact is `high` too: whoever can change it receives the reports of vulnerabilities. Changing one of those wrongly misrepresents the organisation, so it needs a second person (§7).

A group's `organisation.*` settings describe a group that is itself a legal entity or trades separately (a subsidiary, a franchise, a charity's trading arm). Groups that are not leave them unset and inherit.

### 3.3 Value rules

- **Safe text:** Unicode NFC, spaces collapsed, no control, format or private-use characters, bounded. No markup: pages render values as text.
- **URLs:** `https` only (or a site-relative path where stated); no credentials, no `javascript:` or `data:`; at most 2,048 characters.
- **Email addresses:** an organisational mailbox. A personal address is not refused (it cannot be told apart) but the declaration's `possibly-personal` sensitivity applies.
- **Postal addresses:** `{ lines (1 to 4), locality?, region?, postcode?, country }`, `country` an ISO 3166-1 alpha-2 code.

## 4. Scopes and precedence

| Scope | Identifier | Holds values for |
|---|---|---|
| `platform` | none: one per deployment | Every tenant and group, unless they set their own |
| `tenant` | Identity's tenant identifier | The tenant and its groups |
| `group` | Identity's group identifier, of a `standard` group | The group and, for settings that inherit, its descendants |
| `account` | The person's identity (never named in a request: always the subject's own) | That person alone (§4.2) |

The value in force for a key is the first of:

1. the deployment value, when the declaration is `locked`;
2. for an account, its own value; for a group, its own value; then, when the declaration `inherits` by `lineage`, the nearest ancestor's value, from its parent up to its root group;
3. the tenant's value (for an account, the person's home tenant, that of their personal group);
4. the platform value;
5. the deployment value (`app.config.ts` under `configuration.values`, or `NUXT_PUBLIC_CONFIGURATION_*`);
6. the declared default.

Each answer carries its **provenance** per key (`locked`, `account`, `group` with the group's identifier, `tenant`, `platform`, `deployment`, `default`), so the administration page shows what a scope sets and what it inherits, and a scope can clear its value to inherit again.

Inheriting a value is presentational: it confers nothing. Who may change or read a group's values comes from Authorisation for that group (§7, §5), never from the hierarchy, following the Group Model Definition's no-implicit-inheritance rule.

The lineage comes from Identity's directory port at every read (`bounded`) and every change (`strong`); it is never stored here, so a reparented group takes its new ancestors' values at once.

**Scope states.**

| State (from Identity) | Read | Changed |
|---|---|---|
| Tenant `active`; group `active` | Yes | Yes |
| Tenant `closing` | Yes | No (`conflict`, `scope-closing`) |
| Group `archived` or `orphaned` | Yes | No (`conflict`, `scope-read-only`) |
| Tenant `closed`; group `deleted`; unknown | As if it did not exist: `forbidden` over HTTP, `null` to server code | No (`forbidden`) |

### 4.1 Tenant by host name

A request's tenant is the one whose `site.host-names` (a `high`, tenant-only, `server` setting) holds the request's host name, lower case and without port; no tenant matches → platform values only. A host name belongs to one tenant at most: a change claiming one another tenant holds is refused (`conflict`, `host-taken`), at request and again on applying. `X-Forwarded-Host` is read only when the host sets `NUXT_CONFIGURATION_TRUST_FORWARDED_HOST` behind its own proxy. Over HTTP, a request on a tenant's host name reaches only that tenant's scopes and changes, and the platform's. On a host name no tenant claims (the platform's own, e.g. an operators' console), a subject reaches any scope Authorisation lets them, naming a tenant with `?tenantId=`: this is where a tenant gets its first host name.

### 4.2 Accounts

A person's own settings, for what a host or another layer declares per account (the built-in catalogue declares none). An account is governed by the person's personal group and follows Identity's personal-group sovereignty: only that person reads or changes it, with no approver, but stepping up to the change's risk and waiting out a recovery hold. No permission reaches another person's account, whoever holds it. Service identities have none. An account is reachable only while its identity is active; `identity.closed` disposes of it (§14).

An account's values must not describe the person: names, contact details, locale, time zone and chosen theme are Profile's. A setting declared for `account` is never `public`. Its values are no tenant's data: they are left out of tenant exports and are in the person's own export (`exportConfigurationAccountData`).

## 5. Visibility

| Visibility | `platform` and `tenant` values | `group` values |
|---|---|---|
| `public` | Anyone, without signing in, through the public endpoint (§13). Cacheable | Anyone with a membership in effect in the group's tenant. Never anonymous, so the public endpoint never reveals that a group exists |
| `members` | A signed-in subject with a membership in effect in the tenant (for platform values, any signed-in subject) | A subject with a membership in effect in the group itself; membership of an ancestor is not enough |
| `server` | Server functions only; never over HTTP | Likewise |

A subject holding the read permission on the scope's governing group (§7.1) reads every value set there, `server` ones included, to administer them: `configuration.settings:view`, but for the platform `configuration.platform-settings:manage`, so only those who may change the hosting application's settings read them as administrators.

### 5.1 What an administrator sees

Only the scope's own settings. The values in force an administrator is shown cover the keys the scope may set, and of those inherited from above only what the scope's members may read: never a `server` value set at a scope above, and never a setting the scope cannot set. Inheriting confers nothing (§4), so a deeper administrator reaches only the scopes Authorisation gives them, and of those, only what is theirs. Group values are never served anonymously, and a group cannot opt in to it.

There is no `secret` visibility. A secret is never a setting, whatever its visibility: the host keeps it in its secret store and passes it to the layer that uses it.

## 6. Requesting a change

Every change of values is requested as a **pending change**, whatever its risk, following iam-integration's [approvals process](https://github.com/nuxt4-layers/iam-integration/blob/899befcf566775950c4b70b8cf0e7658be1000f9/docs/processes/approvals.md) as Authorisation does for roles and grants ([Authorisation contract](https://github.com/nuxt4-layers/authorisation/blob/342dcbc3b965076c973be29bbd57fbf179c8aaf0/docs/contracts.md) §15). Low-risk changes need no approver and apply at once, but take the same path, so every rule lives in one place.

A request (`configurationChangeRequestSchema`) names:

- the `scope` and its identifier, and for `tenant` the `governingGroupId` (§7.1);
- the keys it sets (a value) or clears (`null`); at least one, and only declared keys settable at that scope;
- the **expected values**: a digest of each changed key's value at that scope as the requester saw it;
- a `justification`: a reason code and, where the governing group requires one, a reference;
- a `correlationId`. The subject comes from the host's subject resolver only.

**Checks, in this order** (keeping errors coarse, as Identity's §12 does):

1. The request is parsed strictly; each value with its declaration's schema. An unknown key, a key not settable at that scope, a `locked` key or an empty change is `validation-failed`, with problem codes, never the value.
2. The scope is located and its governing group found (§7.1). Anything unknown, closed or deleted is `forbidden`.
3. A **service identity** never requests a change: refused as `forbidden` when the subject's `kind` is `service` or the directory's actor `kind` is `service`, read `strong`, so neither alone lets one through.
4. The requester must hold the permission for the scope (§10) on the governing group, through the access-decision port, at `strong` consistency. Refused is `forbidden`.
5. The scope must be open to changes (§4: `scope-closing`, `scope-read-only`) and each expected value must match the value stored now (`values-changed`); otherwise `conflict`.
6. The **risk** is the highest of: each changed key's declared risk; the permission's risk in Authorisation's catalogue; and `high` for any change at `platform` scope, which every tenant sees.
7. The requester steps up to the risk (`STEP_UP_REQUIREMENTS`: `high` aal2; `critical` aal2, phishing resistant, within 15 minutes), else `insufficient-assurance`.
8. The requirement and route are chosen (§7.2) and the change is recorded with its **digest** (§7.3). With no approver needed it applies at once in the same transaction; `configuration.change-requested` is written either way.

**A change confers nothing on anyone**, so its beneficiary is always none, and no change is a self-grant. Naming oneself as `contact.data-protection` is a statement about the organisation that a `high` change's approver checks, not access.

## 7. Approvals

### 7.1 The governing group

Approvals in the suite are decided in a group. Each scope has one:

| Scope | Governing group | Permission requested and approved on it |
|---|---|---|
| `group` | The group itself | `configuration.group-settings:manage` |
| `tenant` | A root group of the tenant, named by the request; the access-governance port confirms it is a root group of that tenant | `configuration.tenant-settings:manage` |
| `platform` | The platform group the host designates (`provideConfigurationPlatformGroup`), as Identity uses it for platform-wide changes | `configuration.platform-settings:manage` |
| `account` | The person's personal group | None: the person alone, with no approver |

A tenant with several root groups may have its settings changed from any of them by someone who holds the permission there; each change records which one governed it, and its approvers are found there.

### 7.2 Requirement and route

The requirement is the governing group's `approvals.required` for the change's risk, from the access-governance port, never below the floor: no approver beyond the requester for `low` and `medium`; one for `high` and `critical`. A group may raise it (Identity's `group.change-approvals`); Configuration never lowers it.

The **route** is chosen as Identity and Authorisation choose it:

1. `none`: no approver required; the change applies at once.
2. `approvers`: enough principals qualify in the governing group, by the access-decision port (they hold the same permission now), other than the requester and the identities the requester controls. Service identities never qualify.
3. Otherwise one owner of the governing group's **parent**; then one owner of the tenant's **root group** (for a change governed by a root group, that is itself, and the next fallback applies); owners from the access-governance port, never the requester. The owner fallbacks ask for one owner even where the group raised its requirement to two.
4. Otherwise a **published delay** (`publishedDelayHighHours`, 72 by default, or `publishedDelayCriticalHours`, 168), the values in force for the governing group. The requester cannot shorten it and may cancel the change. The delay is announced (`configuration.change-requested` with route `published-delay`) so that anyone who would qualify can object by asking an owner to request a contrary change.

A change requested within the requester's **recovery hold** (from the access-governance port) records `heldUntil`, is announced with `configuration.change-held`, and cannot apply before then.

### 7.3 The digest

SHA-256 of the canonical JSON of: the scope and its identifier, the governing group, the requester, the risk, the justification, each changed key with its new value and the digest of its expected value, the required approvals, the route, and the governing group's requirement and the owners' groups as read. Values are part of the digest, never of the events.

### 7.4 Deciding

`decide({ subject, changeId, changeDigest, decision, correlationId })`, `decision` being `approve` or `reject`:

- Only someone who may decide it now (a qualifying approver for `approvers`; an owner, by the access-governance port, of the group recorded for an owner route) or its requester may reach it; anyone else is `forbidden`. A service identity is `forbidden`.
- Refused as `conflict`: the requester (`own-request`), an identity the requester controls, a second decision by the same approver, a change no longer awaiting approval, and a digest that differs from the recorded one or from the change as stored (`change-differs`). An approver short of the risk's step-up is `insufficient-assurance`.
- The approver sees the values being changed, their current values and the provenance: `getConfigurationChange` answers them to whoever may decide.
- A rejection ends the change.

### 7.5 Applying

When enough approvals are recorded, or a published delay or hold ends, the change applies **in the same transaction** as the decision (or maintenance run), its history (§8) and its outbox events, after every rule is checked again:

- the digest, recomputed from the stored change;
- the scope still open to changes, the group still in the tenant, and the governing group still a root group of the tenant (for `tenant`);
- the governing group's requirement no higher than when the digest was taken;
- the requester still holding the permission;
- each changed key still declared, settable at the scope, not `locked`, its stored value still the expected one, and its new value still valid under the declaration's schema;
- the risk no higher than recorded.

A rule that no longer holds **rejects** the change with a code for the server (`values-changed`, `scope-read-only`, `requirement-raised`, …) and writes `configuration.change-decided`; a port or database failure records nothing and leaves the change open.

### 7.6 Expiry and cancelling

A change awaiting an approver expires unapplied after `approvalExpiryDays` (7 by default; the value in force for the governing group). One under a published delay does not expire; it applies when the delay ends. A held, approved change waits as `delayed` until its hold ends. `runConfigurationMaintenance` does each. The requester may cancel an open change; nobody else may.

### 7.7 Reading changes

`getConfigurationChange` answers the requester, whoever may decide, and whoever holds `configuration.settings:view` on the governing group; `listConfigurationChanges` a scope's open changes, under `configuration.settings:view`. Anyone else gets `forbidden`.

## 8. History

Every applied change keeps the previous and the new value of each key, the change's identifier, requester, approvers, time and correlation identifier, so an administrator sees what changed, who asked and who approved, and can restore an earlier value. A restore is an ordinary change, with the approvals its risk needs.

History of `possibly-personal` keys is deleted after the retention period by `runConfigurationMaintenance`: 400 days unless the host chooses another with `provideConfigurationRetention({ days })`, from 30 to 2,190 (`CONFIGURATION_RETENTION`); a period outside the bounds is refused at start-up. It counts from when a change applied or was decided. Decided, expired and cancelled pending changes are kept for the same period. Both are disposed of with their scope (§14).

## 9. Events

Written to Configuration's transactional outbox in the same transaction as the change, and relayed by the host (`relayConfigurationOutbox`), at least once, in order. Every event has an `eventId` (UUIDv7), `type`, `occurredAt`, `correlationId` and `actorId`.

| Event | Data |
|---|---|
| `configuration.change-requested` | `changeId`, `scope`, scope identifier, `governingGroupId`, the keys, `risk`, `route`, `requiredApprovals`, `expiresAt` or `appliesAt` |
| `configuration.change-held` | `changeId`, `heldUntil` |
| `configuration.change-decided` | `changeId`, `outcome` (`applied`, `rejected`, `expired`, `cancelled`), the approvers, a `reasonCode` when rejected |
| `configuration.changed` | `scope`, scope identifier, the keys set or cleared, `changeId` |
| `configuration.reset` | `scope`, scope identifier, `reasonCode` (`tenant-disposed`, `group-disposed`, `account-closed`) |
| `configuration.retention-applied` | How many history rows and pending changes were deleted, when a run deleted any |

Events carry identifiers, keys and codes only: never a value. Notification capabilities tell approvers from `configuration.change-requested`; a consumer that needs a value reads it through `getConfiguration`.

## 10. Permissions

For the host to add to Authorisation's catalogue (`CONFIGURATION_PERMISSIONS`):

| Permission | Risk | Effect | Allows |
|---|---|---|---|
| `configuration.settings:view` | `low` | `view` | Reading a tenant's or group's values, history and pending changes, on its governing group |
| `configuration.group-settings:manage` | `medium` | `manage` | Requesting and approving changes to a group's values, on the group |
| `configuration.tenant-settings:manage` | `high` | `manage` | Requesting and approving changes to a tenant's values, on a root group of the tenant |
| `configuration.platform-settings:manage` | `critical` | `manage` | Reading, requesting and approving changes to platform values, on the platform group |

A change's risk is never below its permission's (§6, step 6). `high` and `critical` permissions are outside Authorisation's wildcards; a host names them in roles explicitly. With the suite's default roles, only the platform group's owners hold `configuration.platform-settings:manage`: the hosting application's own settings belong to its super administrators, and to nobody else unless explicitly granted.

## 11. Ports

| Port | Required | Supplied from | Purpose |
|---|---|---|---|
| `ConfigurationDatabase` | Yes | Host | PostgreSQL pool (runtime role), schema, and optionally the migration pool, under ADR-0002 and ADR-0006 |
| `ConfigurationCatalogue` | Yes | Host | The host's and other layers' declarations (§3.1), added to the layer's own |
| `ConfigurationDirectory` | For `group` and `account` scopes and `members` visibility | Identity's directory port, through the host | A group's tenant, lineage, kind and state; an actor's `kind`, memberships in effect and, while active, personal group |
| `ConfigurationTenants` | No: without it, the states Identity's tenant events announced (§14) | Identity, through the host | Whether a tenant exists, and its state |
| `ConfigurationGovernance` | For changes | Identity's access-governance port (`getIdentityAccessGovernance`), through the host | The governing group's parent, root, approval requirement and reference rule, safety periods in force, the requester's recovery hold and controlled identities; owners for the fallbacks |
| `ConfigurationAccessDecision` | For changes and reading | Authorisation (`authorise`, `countAuthorisationQualifying`), through the host | Whether an identity holds a permission (§10) on a group now; how many others do, for the route; a permission's risk |
| `ConfigurationSubjectResolver` | For the endpoints | Authentication, through the host | The signed-in subject for a request, with its `kind` and assurance (level, phishing resistance, `authenticatedAt`), or `null` |
| `ConfigurationPlatformGroup` | For `platform` scope changes | Host | The platform group's identifier |
| `ConfigurationRetention` (`provideConfigurationRetention`) | No: 400 days without it | Host | How long history of `possibly-personal` keys and decided changes are kept, within 30 to 2,190 days (§8) |
| `ConfigurationClock` | No: the system clock without it | Host (the suite's one clock) | The current time for expiries, delays, holds and retention |

Required ports fail closed: a failure is `unavailable` and records nothing. There is no in-memory or file store: without the database, only deployment values and defaults are served, read-only, and every change answers `unavailable`. The layer ships reference adapters (`server/utils/configuration-adapters.ts`, auto-imported): `configurationDirectoryFromIdentity(getIdentityDirectory())`, `configurationGovernanceFromIdentity(getIdentityAccessGovernance())`, `configurationAccessDecisionFromAuthorisation({ qualifies: authorisationQualifies, countQualifying: countAuthorisationQualifying })` and `configurationSubjectResolverFromAuthentication({ getAuthenticatedPrincipal })`. They import no member: the host passes the functions in, and structural types name what each needs. They translate vocabulary only and pass every failure on.

## 12. Server functions

| Function | Does |
|---|---|
| `migrateConfigurationDatabase()` | Applies append-only migrations through the migration pool |
| `getConfiguration({ tenantId?, groupId?, accountId?, keys?, visibility })` | Values in force with provenance (§4), up to the visibility asked; server code passes `server` |
| `getConfigurationChanges()` | `request`, `decide`, `cancel`, `get` and `readScope` (§6, §7, §5.1); the endpoints and pages call it |
| `listConfigurationHistory({ subject, target, limit? })` | §8 |
| `exportConfiguration({ scope })` | A versioned document of the values set at a platform, tenant or group scope (§12.2). Server-only |
| `requestConfigurationImport({ subject, document, target, justification, correlationId })` | Turns such a document into one pending change (§12.2). Server-only |
| `exportConfigurationTenantData({ tenantId })`, `disposeConfigurationTenant({ tenantId, correlationId })` | The tenant's part of tenant export and disposal (§14). Server-only |
| `applyConfigurationIdentityEvent(event)` | The host's handler for Identity's relayed events (§14). Idempotent by event id. Server-only |
| `syncConfigurationTenants(tenants)` | Records tenants that existed before the layer was installed, which no `tenant.created` will announce. Server-only |
| `disposeConfigurationGroup({ groupId, correlationId })` | A deleted group's part of its disposal (§14). Server-only |
| `exportConfigurationAccountData({ identityId })`, `disposeConfigurationAccount({ identityId, correlationId })` | A person's account in their data-subject export, and its disposal on closure (§4.2, §14). Server-only |
| `relayConfigurationOutbox({ publish, limit? })` | §9 |
| `runConfigurationMaintenance()` | Expires, applies delayed and released changes (§7.6), and applies retention (§8) |

### 12.1 Providing values to other layers

Other layers never import Configuration. A layer that needs a value (Authentication's site name in an email, Profile's legal links on its pages) declares a port of its own, and the host fills it:

```ts
provideAuthenticationSiteIdentity(async ({ tenantId }) => {
  const answer = await getConfiguration({ tenantId, keys: ['site.name'], visibility: 'server' })
  return { siteName: answer.values['site.name'] }
})
```

### 12.2 Moving values between environments

`exportConfiguration` answers `{ format: 'nuxt4-layers.configuration', version: 1, scope, exportedAt, values }`: the values set at that scope, and nothing that names where they came from. An account is never exported this way; a person's values are in their own export.

`requestConfigurationImport` takes such a document and a target of the same kind of scope (`scope-mismatch` otherwise), and requests one change of the keys whose value differs there (`nothing-to-change` when none does), with each key's current digest as `expected`. It is an ordinary request (§6): the subject needs the scope's permission, every value is checked against the catalogue, and the riskiest key decides the approvals. Importing never bypasses them. Keys the document leaves out are left as they are.

## 13. HTTP API

Under `/api/configuration`. Endpoints take the subject only from the host's resolver, parse bodies with strict schemas, call the server functions (never SQL), and answer errors as coarse codes. State-changing requests must carry an `Origin` matching the host's base URL.

| Method and path | Access | Does |
|---|---|---|
| `GET /public` | Anyone | `public` platform and tenant values in force for the request's tenant (§4.1), with an `ETag` and a short `Cache-Control` |
| `GET /` | Signed in | Adds `members` values, with `?groupId=` a group's values the subject may read (§5), and with `?scope=account` the subject's own account (§4.2) |
| `GET /admin?scope=…&groupId=…&governingGroupId=…` | The read permission (§5); `scope=account`, the person | The scope's own values, provenance, declarations and open changes, for editing (§5.1) |
| `POST /changes` | §6 | Requests a change |
| `GET /changes/{changeId}` | §7.7 | One change, with its values for those who may decide it |
| `POST /changes/{changeId}/decision` | §7.4 | Approves or rejects, with the digest shown |
| `POST /changes/{changeId}/cancel` | The requester | Cancels |
| `GET /history?scope=…` | The read permission (§5); `scope=account`, the person | §8 |

Import, export, disposal, maintenance and the relay are never endpoints.

### 13.1 Errors

| Code | HTTP | Meaning |
|---|---|---|
| `unauthenticated` | 401 | No signed-in subject |
| `forbidden` | 403 | Refused. Never says whether a tenant, group or change exists |
| `insufficient-assurance` | 403 | The requester or approver must step up to the change's risk |
| `validation-failed` | 400 | Malformed request; problem codes only |
| `conflict` | 409 | A rule refused it: `values-changed`, `scope-closing`, `scope-read-only`, `own-request`, `already-decided`, `not-open`, `change-differs` |
| `unavailable` | 503 | Database, catalogue, port or clock failure. Fails closed |

## 14. End of life

The host relays Identity's events to `applyConfigurationIdentityEvent`, which applies each once: `tenant.created`, `tenant.closing`, `tenant.closing-cancelled` and `tenant.closed` keep the tenant states (a closed tenant stays closed); `group.deleted` and `tenant.closed` with `disposal: 'due'`, and `group.disposal-due` and `tenant.disposal-due`, dispose as below; `identity.closed` disposes of the identity's account (`account-closed`). A deferred disposal (a legal hold) disposes of nothing until Identity says it is due. Other events are ignored.


- **Group deletion** ([group deletion](https://github.com/nuxt4-layers/iam-integration/blob/899befcf566775950c4b70b8cf0e7658be1000f9/docs/processes/group-deletion.md)): a deleted group's values stop resolving at once, because Identity's directory answers it as deleted (§4). When the disposal is due, `disposeConfigurationGroup` cancels its open changes, deletes its values, changes and history, and emits `configuration.reset` (`group-disposed`).
- **Tenant shutdown** ([tenant lifecycle](https://github.com/nuxt4-layers/iam-integration/blob/899befcf566775950c4b70b8cf0e7658be1000f9/docs/processes/tenant-lifecycle.md)): the host calls `exportConfigurationTenantData` for the tenant export; when the disposal is due, `disposeConfigurationTenant` does the same for the tenant and every group of it.
- **Data-subject requests**: Configuration holds a person only where a `possibly-personal` value names them or a change records them as requester or approver. Values are corrected by an ordinary change; requester and approver identifiers are opaque and are anonymised by Profile's unlinking, like every other member's.

## 15. Presentation

Components, composables and pages live in `app/` and reach the server only through `useConfiguration()` and `useConfigurationAdministration()`. They decide nothing. Text comes from `app/configuration-messages.ts` through `useConfigurationText()`; hosts override wording in `app.config.ts` under `configuration.messages`. Styling uses only Theme Manager's SemanticPresentationTheme vocabulary (`configurationClasses`), as Profile's, Identity's and Authorisation's pages do; hosts add `@nuxt4-layers/configuration/tailwind.css` to their stylesheet.

- Public: `useConfiguration()`, `useConfigurationHead()`, and `ConfigurationSiteName`, `ConfigurationOrganisationDetails`, `ConfigurationContact`, `ConfigurationSocialLinks`, `ConfigurationLegalLinks` (plain semantic markup).
- Administration pages, registered by `modules/configuration-pages.ts` (`configuration: { pages: { enabled, paths: { settings, changes } }, signIn }` in the host's `nuxt.config.ts`; by default `/configuration` and `/configuration/changes`, scoped by `?scope=platform`, `?scope=tenant&governingGroupId=…` or `?scope=group&groupId=…`). Each setting shows its value in force, where it comes from and its risk; its form is built from the value's JSON Schema, so a host's own settings get one too. Saving requests a change and says whether it applied or awaits approval, by whom and until when. The changes page shows what each open change would do beside what is there now; others may approve or reject, the requester may withdraw. The pages are never framed, cached or sent as a Referer.
- Deliberate pairings, which a host's theme must keep legible (`app/configuration-pairings.ts`): `pen-muted-default` on `fill-base-default` (hints and notes on the card), `edge-error-default` on `fill-input-default` (an invalid field's border), `edge-base-active` on `fill-base-default` (the focus indicator).

## 16. Versioning

Contract version 1 (`CONFIGURATION_CONTRACT_VERSION`), following the IAM members' rules: frozen for 1.x. A removed or narrowed type, function, endpoint, event or port, or a stricter rule a host must act on, needs a new contract version. An added setting in the layer's catalogue, an added export, or a raised risk is a minor release; a removed setting or a lowered risk is not allowed in 1.x. `tests/contracts.test.ts` pins version 1's exports and its catalogue's keys and risks.

## 17. Decisions

The questions left open while version 1 was drafted, as decided:

1. **History retention.** 400 days by default; a host chooses from 30 to 2,190 (§8). Kept short enough that `possibly-personal` history does not outlive its use, long enough for a year's audit.
2. **Localised values.** One value per key. A site in several languages declares a localised setting of its own, whose schema is a map of locale to text (`{ 'en-GB': …, 'cy-GB': … }`); the catalogue needs no change for it, and the layer may add localised variants of its own keys later as new keys, a minor release.
3. **Tenants with several root groups.** Any root group of the tenant governs its settings (§7.1). Each change records which one, and its approvers are found there. A designated root group would need Identity to name one, which it does not; adding it later narrows who may govern, so it would be contract version 2.
4. **Membership.** Configuration stays a platform layer the host coordinates, not a member of the IAM suite: it follows iam-integration's approvals process for its own changes, consumes Identity's events through `applyConfigurationIdentityEvent`, and reaches the members only through its own reference adapters. A person's account values reach their data-subject export through the host (`exportConfigurationAccountData`); wiring that into iam-integration's request coordinator is iam-integration's change.
