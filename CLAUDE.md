# @nuxt4-layers/configuration-service — notes for Claude

## What this is
Nuxt 4 foundation layer for the facts a site, a tenant or a group states about itself (site name, organisation details, contact points, links, presentation defaults). Governed by `nuxt4-layers/platform-architecture`; persistence follows ADR-0002 and ADR-0006. Not a member of the IAM suite, but follows iam-integration's approvals process for its own changes. British spelling everywhere, including code and the manifest.

## Commands
- `pnpm install`, then `pnpm dev:prepare` for Nuxt types. Never add a `prepare`/`postinstall` script
- `pnpm check` = `nuxt typecheck` + `vitest run`; run it after every code change. Single file: `pnpm vitest run tests/<name>.test.ts`
- Database suites need `CONFIGURATION_TEST_DATABASE_URL` (admin URL of a local, disposable PostgreSQL 16); they skip locally without it and fail in CI
- `pnpm build:playground` proves the layer composes in a host
- Browser tests: `pnpm test:e2e` (builds the playground, then Playwright with axe in light and dark mode, port 3442). Needs `CONFIGURATION_TEST_DATABASE_URL`; locally set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Playwright's own browser is not installed
- Theme Manager is pinned as `git+https://github.com/nuxt4-layers/theme-manager.git#<sha>`; the lockfile must record the `codeload.github.com` tarball, never `git@github.com`
- Never edit a released migration in `server/database/migrations.ts`; add a new one
- `python3 scripts/check_markdown.py` checks headings, local links and that links to other `nuxt4-layers` documents are pinned to a tag or commit. Run it after every documentation change.

## Rules
- Organisational facts only. Never store personal data (Profile's), sign-in identifiers or policy (Authentication's), groups, group settings or memberships (Identity's), roles or access (Authorisation's), theme definitions (Theme Manager's) or secrets (the host's).
- Nothing undeclared is stored: every setting has a declaration (docs/contracts.md §3).
- Inheriting a value through the group lineage confers nothing; who may read or change a scope comes from Authorisation.
- Every change is a pending change following the approvals process (docs/contracts.md §6, §7); `high` and `critical` changes need a second person or a published delay. No bypass, including imports.
- Members are reached only through ports the host supplies; never import another `@nuxt4-layers/*` package.
- Events and logs carry identifiers, keys and codes only, never a value.
- Required ports fail closed. No implicit in-memory or file fallback stores.
- Contract (`contracts/`, `shared/`) imports only zod; enforced by `tests/contracts.test.ts`. `server/internal` and `server/database` are private.
- Keep `docs/contracts.md` and `docs/roadmap.md` in step with code, briefly: this is a code repository, not a documentation exercise.
- Layout: one self-contained layer at the repository root, Nuxt 4 structure (`app/`, `server/`, `shared/`); hosts consume it through `extends`. The contract is `shared/contracts.ts` (export `./contracts`). `playground/` is a test host, never published.
- Endpoints (`server/api/configuration/`) take the subject only from `requireSubject`/`optionalSubject` and the tenant only from the host name (`tenantOf`); parse bodies and queries strictly; call the server functions, never SQL; are wrapped in `configurationHandler`. `tests/http.test.ts` mounts every file. Group values are never served anonymously.
- Pages and components (`app/`) reach the server only through the layer's composables; never `$fetch` or `/api/` in a component or page. Text comes from `app/configuration-messages.ts` via `useConfigurationText()`. Style only through `configurationClasses`; any cross-role pairing goes in `app/configuration-pairings.ts` and docs/contracts.md §15. Never weaken an axe or contrast assertion to get green.
- Package manager: pnpm. Commit `pnpm-lock.yaml`.
