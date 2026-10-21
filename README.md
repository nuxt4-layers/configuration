# @nuxt4-layers/configuration

Nuxt 4 foundation layer for the facts a site states about itself and its organisation: its name, the organisation's legal details and address, contact points, social links, legal pages and presentation defaults, for the platform, each tenant and each group; and the settings a host declares per account, which only the account's own person reads or changes.

A platform foundation layer, not a member of the Identity and Access Management (IAM) suite. It reaches [`identity`](https://github.com/nuxt4-layers/identity) and [`authorisation`](https://github.com/nuxt4-layers/authorisation) only through ports the host supplies, never imports them, and follows the suite's [approvals process](https://github.com/nuxt4-layers/iam-integration/blob/899befcf566775950c4b70b8cf0e7658be1000f9/docs/processes/approvals.md) for its own changes.

**Status:** 1.2.0, contract version 1 ([contract](docs/contracts.md), [roadmap](docs/roadmap.md)): the core, the HTTP API (tenant by host name), `useConfiguration()`, the public components, the administration pages, accounts, export and import, and composition with the IAM members through the layer's own adapters, proven in the platform test harness. From 1.1.0 the package is `@nuxt4-layers/configuration`, named after its repository like every other layer (1.0.0 was published as `@nuxt4-layers/configuration-service`). 1.2.0 adds `contact.security`, the contact a site's `security.txt` names.

## Owns

- Declared settings: each one a key, a schema, the scopes that may set it, who may read it, its risk and its default. Nothing undeclared is stored.
- The values of those settings for the platform, for each tenant, for each standard group and for each person's own account, keyed by Identity's opaque identifiers.
- Resolving a setting's value in force, from its default, the deployment, the platform, the tenant and the group's lineage, with where each value came from.
- Pending changes to those values, their approvals and their history.

## Never owns

| Not here | Owned by |
|---|---|
| Anything that describes a person (names, contact details, locale, time zone, chosen theme) | Profile |
| Sign-in identifiers, credentials and authentication policy (MFA, session lifetimes) | Authentication |
| Tenants, groups, group names, the hierarchy, group settings, approval requirements, safety periods and memberships | Identity |
| Roles, grants and access decisions | Authorisation |
| Theme definitions | Theme Manager |
| Secrets (SMTP passwords, API keys, client secrets) | The host's environment or secret store |
| Uploaded files (logos, images) | The host's asset store: configuration holds only a reference |

An organisation's address or contact point can still be personal data (a sole trader's home, a named officer). Such settings are declared `possibly-personal`: they never reach events or logs, and a contact point names a role or a mailbox, never a person. Where a person must be named, the setting holds Identity's identifier and the page shows the name through Profile.

## Interfaces

| Direction | Interface | Purpose |
|---|---|---|
| Consumes from Identity | Directory, access-governance and tenant ports | Groups' tenant, lineage, kind and state; a tenant's state; approval requirements, safety periods and owners for the approval route |
| Consumes from Identity | Its tenant and disposal events, through `applyConfigurationIdentityEvent` | Tenant states, and disposal of a group's or tenant's values when due |
| Consumes from Authorisation | Access-decision port | Whether the subject may request or approve a change, and how many others qualify |
| Consumes from the host | Subject resolver, database, clock, setting declarations | The signed-in subject and its assurance; storage under ADR-0002; the host's and other layers' own settings |
| Provides to pages | `useConfiguration()`, `useConfigurationHead()`, `Configuration*` components | Values in force, head and SEO defaults, and administration pages with pending changes |
| Provides to other layers, through the host | `getConfiguration()` | Values the host passes into other layers' ports (for example the site name in Authentication's emails) |
| Publishes | `configuration.change-requested`, `configuration.change-decided`, `configuration.change-held`, `configuration.changed`, `configuration.reset` | Keys, scopes, identifiers and codes only, never a value |

## Documentation

- [Contract](docs/contracts.md) (version 1): boundaries, declarations, scopes and precedence, visibility, changes and approvals, events, ports, server functions, HTTP API and presentation
- [Roadmap](docs/roadmap.md)

## Documentation checks

`python3 scripts/check_markdown.py` checks headings, local links, and that links to other `nuxt4-layers` documents are pinned to a tag or commit.

## Governing decisions and specifications

- [ADR-0002 — Composition-Supplied Persistence and Capability-Owned Schemas](https://github.com/nuxt4-layers/platform-architecture/blob/93f3d6fb144b72d61cfb172b6a50eb6c5af9f489/docs/decisions/ADR-0002-composition-supplied-persistence-and-capability-owned-schemas.md)
- [ADR-0003 — Group Model and Identity Before Logging](https://github.com/nuxt4-layers/platform-architecture/blob/93f3d6fb144b72d61cfb172b6a50eb6c5af9f489/docs/decisions/ADR-0003-group-model-and-identity-first.md)
- [ADR-0004 — Documentation Placement](https://github.com/nuxt4-layers/platform-architecture/blob/93f3d6fb144b72d61cfb172b6a50eb6c5af9f489/docs/decisions/ADR-0004-documentation-placement.md)
- [ADR-0006 — Polyglot Persistence and Data-Store Security](https://github.com/nuxt4-layers/platform-architecture/blob/93f3d6fb144b72d61cfb172b6a50eb6c5af9f489/docs/decisions/ADR-0006-polyglot-persistence-and-data-store-security.md)
- [Approvals (two-person rule)](https://github.com/nuxt4-layers/iam-integration/blob/899befcf566775950c4b70b8cf0e7658be1000f9/docs/processes/approvals.md)
- [Tenant lifecycle](https://github.com/nuxt4-layers/iam-integration/blob/899befcf566775950c4b70b8cf0e7658be1000f9/docs/processes/tenant-lifecycle.md) and [group deletion](https://github.com/nuxt4-layers/iam-integration/blob/899befcf566775950c4b70b8cf0e7658be1000f9/docs/processes/group-deletion.md)
