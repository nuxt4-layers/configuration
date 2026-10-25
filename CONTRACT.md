# Configuration Host Contract

What a host needs to compose Configuration 1.2.0 (contract version 1), and nothing else ([ADR-0012](https://github.com/nuxt4-layers/platform-architecture/blob/249cd48af72e0a3fc232d40c8aa05e8da3b32069/docs/decisions/ADR-0012-trivial-composition.md#6-a-one-page-host-contract) §6). The [contract](docs/contracts.md) and the code stay the source: where this page disagrees with them, this page is the bug. Configuration does not meet ADR-0012 yet: it has no single call taking the shared shapes, no `examples/minimal-host`, and no default for its Identity and Authorisation ports, so today the host wires the layer's own adapters below itself.

## Install

```json
"@nuxt4-layers/configuration": "github:nuxt4-layers/configuration#v1.2.0"
```

`extends: ['@nuxt4-layers/configuration']` in `nuxt.config.ts`; install with `--frozen-lockfile`. One Nitro plugin, beside the IAM suite's (members' functions and the layer's adapters are auto-imported):

```ts
provideConfigurationDatabase({ dialect: 'postgres', pool, migrationPool, runtimeRole: 'configuration_runtime' })
provideConfigurationCatalogue([demoEnabled]) // the host's own declarations, below
provideConfigurationDeployment({ 'site.name': 'Example', 'demo.enabled': process.env.DEMO_ENABLED === 'true' })
provideConfigurationSubjectResolver(configurationSubjectResolverFromAuthentication({ getAuthenticatedPrincipal }))
provideConfigurationDirectory(configurationDirectoryFromIdentity(getIdentityDirectory()))
provideConfigurationGovernance(configurationGovernanceFromIdentity(getIdentityAccessGovernance()))
provideConfigurationAccessDecision(configurationAccessDecisionFromAuthorisation({ qualifies: authorisationQualifies, countQualifying: countAuthorisationQualifying }))
provideConfigurationPlatformGroup(process.env.IDENTITY_PLATFORM_GROUP_ID!)
await migrateConfigurationDatabase()
```

Call `provideConfigurationCatalogue` before `provideConfigurationDeployment`: deployment values are parsed against the catalogue, and an undeclared key or invalid value throws at start-up.

## Settings

| Setting | Default | Does |
|---|---|---|
| `NUXT_CONFIGURATION_TRUST_FORWARDED_HOST` (`runtimeConfig.configuration.trustForwardedHost`) | `false` | `true` only behind the host's own proxy that sets `X-Forwarded-Host`; otherwise a client could choose its tenant |
| `configuration.pages.enabled` (`nuxt.config.ts`) | `true` | `false` registers no administration page; components and the API remain |
| `configuration.pages.paths.settings`, `.changes` | `/configuration`, `/configuration/changes` | Where the administration pages live; absolute paths only |
| `configuration.signIn` | `/sign-in` | The sign-in page the pages link to when signed out |
| `configuration.messages` (`app.config.ts`) | en-GB catalogue | Wording overrides, by message key (§Screens) |
| `provideConfigurationDeployment(values)` | None | The deployment's values: the only source of `locked` settings, and the layer below the platform's for the rest |
| `provideConfigurationRetention({ days })` | 400 | How long `possibly-personal` history and decided changes are kept; 30 to 2,190, else start-up fails |
| `site.host-names` (a tenant's setting, `high`, `server`) | None | The host names that select a tenant; a request on any other name sees platform values only |

### Scopes and precedence

| Scope | Holds values for | Changed by |
|---|---|---|
| `platform` | The whole deployment, below every tenant and group | `configuration.platform-settings:manage` on the platform group; always at least `high` |
| `tenant` | A tenant and its groups | `configuration.tenant-settings:manage` on a root group of the tenant, named as `governingGroupId` |
| `group` | A `standard` group and, for settings that inherit by `lineage`, its descendants | `configuration.group-settings:manage` on the group itself |
| `account` | One person alone: their own settings, never naming them in a request | That person only, with no approver; no permission reaches another's account |

The value in force is the first of: the deployment value when `locked`; the account's or group's own value, then (by `lineage`) the nearest ancestor's; the tenant's; the platform's; the deployment value; the declared default. Each answer carries its provenance per key. Inheriting a value confers no access.

### Declaring a setting

The layer's own keys live in the reserved `site`, `organisation`, `contact`, `social`, `legal` and `seo` namespaces. A host declares its own:

```ts
const demoEnabled = defineConfigurationSetting({ key: 'demo.enabled', schema: z.boolean(), scopes: ['platform'], visibility: 'public', sensitivity: 'organisational', risk: 'low', default: false, locked: true })
```

`scopes` any of the four; `visibility` `public`, `members` or `server` (an `account` setting is never `public`); `sensitivity` `organisational` or `possibly-personal`; `risk` `low` to `critical`; `inherits` `lineage` (default) or `none`. A `locked` setting is set only by `provideConfigurationDeployment`: no scope, page or import changes it at run time, and a change naming it is `validation-failed`. Use it for what the deployment, not an administrator, decides, such as `demo.enabled`. Never declare a secret, personal data or another member's policy.

## Host passes

| Need | Shared shape (ADR-0012 §2) | Today |
|---|---|---|
| Database | A `pg` pool; the layer owns its schema | `{ dialect: 'postgres', pool, schema?: 'configuration', migrationPool?, runtimeRole? }`. Without it only deployment values and defaults are served, and every change is `unavailable` |
| Caller | `resolveCaller(event)` | `provideConfigurationSubjectResolver({ resolve(event) })` → `{ identityId, kind: 'person' \| 'service', assurance: { level, phishingResistant, authenticatedAt } }` or `null`; the tenant comes from the host name, never the caller |
| Access | `decide(caller, action, resource)` | Not offered yet. Four ports, filled by the adapters above: access decision (`allows`, `countQualifying`, `riskOf`), Identity's directory and access governance, and the platform group. `provideConfigurationTenants({ describeTenant })` is optional |
| Mail | `send(...)` | None: Configuration sends no mail. Notify approvers from `configuration.change-requested` |
| Events | The outbox, drained by `relay()` | `relayConfigurationOutbox({ publish, limit? })`. Inbound: relay Identity's events to `applyConfigurationIdentityEvent(event)`; call `syncConfigurationTenants(tenants)` once for tenants that predate the layer |
| Scheduled work | `tasks: { name, every, run }[]` | `runConfigurationMaintenance()` (expiries, delays, holds, retention) and the relay, on the host's scheduler, e.g. every few minutes |
| Clock | `now()` | `provideConfigurationClock({ now })`; system clock without it. The suite's one clock, never movable outside tests |
| Settings | Application decisions | `provideConfigurationCatalogue(declarations)`, `provideConfigurationDeployment(values)` |

## Client and server functions

| Where | Function | Does |
|---|---|---|
| Client | `useConfiguration({ signedIn?, groupId? })` | `{ values, value(key), data, error, status, refresh }`: public values for this host name, or what the signed-in viewer may read |
| Client | `useConfigurationHead()` | Title template, `lang`, description and `og:site_name` from public values |
| Client | `useConfigurationAdministration()` | `readScope`, `requestChange({ target, set, expected, justification })`, `decide(change, 'approve' \| 'reject')`, `cancel(change)` |
| Server | `getConfiguration({ tenantId?, groupId?, accountId?, keys?, visibility })` | Values in force with provenance; server code passes `'server'`. How other layers get values: the host fills their ports with it |
| Server | `getConfigurationChanges()` | `request`, `decide`, `cancel`, `get`, `readScope` |
| Server | `listConfigurationHistory`, `exportConfiguration`, `requestConfigurationImport` | History; a scope's values as a document; that document as one ordinary pending change |
| Server | `exportConfigurationTenantData`, `disposeConfigurationTenant`, `disposeConfigurationGroup`, `exportConfigurationAccountData`, `disposeConfigurationAccount` | The layer's part in tenant export, disposal and data-subject requests |
| Server | `migrateConfigurationDatabase()`, `relayConfigurationOutbox`, `runConfigurationMaintenance()` | Migrations, events, scheduled work |

HTTP under `/api/configuration`: `GET /public`, `GET /`, `GET /admin`, `POST /changes`, `GET /changes/{id}`, `POST /changes/{id}/decision`, `POST /changes/{id}/cancel`, `GET /history`. Errors are `{ code, messageKey, reason? }`: `unauthenticated` 401, `forbidden` 403, `insufficient-assurance` 403, `validation-failed` 400, `conflict` 409, `unavailable` 503. `reason` comes only with `conflict` and `validation-failed` (`values-changed`, `scope-closing`, `scope-read-only`, `own-request`, `already-decided`, `change-differs`, `host-taken`, …; `CONFIGURATION_CONFLICT_REASONS`).

## Permissions

Add `CONFIGURATION_PERMISSIONS` to Authorisation's catalogue, register their resource types (`configuration.settings`, `configuration.group-settings`, …: the resource is the governing group itself) and name them in roles explicitly: `high` and `critical` are outside wildcards.

| Permission | Risk | Allows, on the governing group |
|---|---|---|
| `configuration.settings:view` | low | Reading a tenant's or group's values (`server` ones too), history and open changes |
| `configuration.group-settings:manage` | medium | Requesting and approving a group's changes |
| `configuration.tenant-settings:manage` | high | Requesting and approving a tenant's changes, on one of its root groups |
| `configuration.platform-settings:manage` | critical | Reading, requesting and approving platform changes, on the platform group |

How a change is decided: every change is a pending change, whatever its risk. The requester must hold the scope's permission now (`strong`); its risk is the highest of each key's risk, the permission's risk and, at `platform`, `high`; the requester steps up to it (`high` aal2; `critical` aal2, phishing resistant, within 15 minutes). `low` and `medium` apply at once. `high` and `critical` need one approver who holds the same permission, else an owner of the parent or root group, else a published delay (72 or 168 hours). An approval is bound to the change's digest; every rule is checked again on applying.

## Screens

The presentation part is styled only with Theme Manager's vocabulary. Import `@nuxt4-layers/theme-manager/presentation.css`, then `@nuxt4-layers/configuration/tailwind.css`.

| Page | Default path | Scope, from the query |
|---|---|---|
| Settings | `/configuration` | `?scope=platform`, `?scope=tenant&governingGroupId=…` (and `&tenantId=…` on the platform's host name), `?scope=group&groupId=…`, `?scope=account` |
| Changes | `/configuration/changes` | As above |

Move them with `configuration: { pages: { paths: { settings, changes } } }`; keep only the components with `pages: { enabled: false }`. ADR-0009's `presentation: false` is not offered yet: components (`ConfigurationSiteName`, `ConfigurationOrganisationDetails`, `ConfigurationContact`, `ConfigurationSocialLinks`, `ConfigurationLegalLinks` and the administration ones) are auto-registered but render only where used.

Wording: the en-GB catalogue's `configuration.*` keys, overridden in `app.config.ts` under `configuration.messages`; errors `configuration.error.<code>`, reasons `configuration.reason.<reason>`. Label a host's own setting with `configuration.setting.<key>` (else the key shows) and a form field with `configuration.field.<name>`. Keep legible: `pen-muted-default` on `fill-base-default`, `edge-error-default` on `fill-input-default`, `edge-base-active` on `fill-base-default`.

## Headless surface

A screen the host draws itself must still:

- take the signed-in person only from the subject resolver and the tenant only from the host name, and decide nothing: every action is decided again on the server;
- send administration pages with `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store` (the layer's pages set them);
- send state-changing requests with an `Origin` on the request's own host;
- send each changed key's `expected` digest with a change, and a decision with the change's `digest`, reloading on `values-changed` or `change-differs`;
- show what a change would do beside what is in force, with its risk and provenance;
- render values as text, never markup; show a refused or unknown tenant, group or change alike;
- meet WCAG 2.2 AA in light and dark mode.

## You will hit this

- Tenant, group and identity identifiers are Identity's opaque UUIDv7s. Events and logs carry identifiers, keys and codes only, never a value.
- Keys are `namespace.name`, lower-case ASCII with `-`. A duplicate, a reserved namespace or a default the schema refuses fails at start-up.
- The docs name `app.config.ts` `configuration.values` and `NUXT_PUBLIC_CONFIGURATION_*` for deployment values; 1.2.0 reads only `provideConfigurationDeployment`.
- A tenant's first host name is set from the platform's own host name, with `?tenantId=`. A host name belongs to one tenant (`host-taken`).
- Group values are never served anonymously; `members` group values need a membership of that group, not an ancestor.
- `forbidden` also means "does not exist". A missing required port throws `ConfigurationCompositionError` at first use and answers `unavailable`; nothing falls back.
- Service identities never request or approve. Nobody approves their own change (`own-request`) or one by an identity they control.
- A change within the requester's recovery hold waits until the hold ends. A closing tenant, or an archived or orphaned group, is read-only.
- Account settings must not describe the person: names, contact details, locale, time zone and theme are Profile's.
