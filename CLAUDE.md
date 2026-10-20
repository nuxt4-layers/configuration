# @nuxt4-layers/configuration-service — notes for Claude

## What this is
Nuxt 4 foundation layer for the facts a site, a tenant or a group states about itself (site name, organisation details, contact points, links, presentation defaults). Governed by `nuxt4-layers/platform-architecture`; persistence follows ADR-0002 and ADR-0006. Not a member of the IAM suite, but follows iam-integration's approvals process for its own changes. British spelling everywhere, including code and the manifest.

## Commands
- `python3 scripts/check_markdown.py` checks headings, local links and that links to other `nuxt4-layers` documents are pinned to a tag or commit. Run it after every documentation change.

## Rules
- Organisational facts only. Never store personal data (Profile's), sign-in identifiers or policy (Authentication's), groups, group settings or memberships (Identity's), roles or access (Authorisation's), theme definitions (Theme Manager's) or secrets (the host's).
- Nothing undeclared is stored: every setting has a declaration (docs/contracts.md §3).
- Inheriting a value through the group lineage confers nothing; who may read or change a scope comes from Authorisation.
- Every change is a pending change following the approvals process (docs/contracts.md §6, §7); `high` and `critical` changes need a second person or a published delay. No bypass, including imports.
- Members are reached only through ports the host supplies; never import another `@nuxt4-layers/*` package.
- Events and logs carry identifiers, keys and codes only, never a value.
- Required ports fail closed. No implicit in-memory or file fallback stores.
- Keep `docs/contracts.md` and `docs/roadmap.md` in step with each other and, later, with code.
