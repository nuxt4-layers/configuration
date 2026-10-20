# Roadmap

The layer is specified before it is built. Each phase keeps the [contract outline](contracts.md) in step with the code.

## Phase 0: specification (done)

- The README and the contract outline: boundaries, declarations, scopes (`platform`, `tenant`, `group`) and precedence, visibility, pending changes with approvals for `high` and `critical` settings, events, ports, server functions, HTTP API and presentation.

## Phase 1: contract and core (done)

- `contracts/` and `shared/`: declaration, value, request, change and event schemas, the layer's catalogue, `canonicalJson` and the digest, importing only zod.
- Storage under ADR-0002 and ADR-0006: append-only migrations, a runtime role that owns nothing, values, pending changes, history and the outbox.
- Resolution with provenance through the group lineage; pending changes, approvals, routes and re-checks on applying; maintenance and the relay.
- Tests proving: no undeclared key is stored; no inherited value confers access; a `high` change never applies without a second person or a published delay; an approval is bound to the digest; a change made against stale values is rejected; a service identity never requests or decides; no event carries a value.

## Phase 2: endpoints and presentation (done)

- Done: tenant by host name, `/api/configuration/*`, `useConfiguration()`, `useConfigurationHead()`, the public `Configuration*` components, a playground host, and the settings and changes pages (Theme Manager's vocabulary, axe in light and dark mode).

## Phase 3: composition

- A playground host with reference adapters to Identity's and Authorisation's server functions, and end-of-life handlers for `group.disposal-due` and `tenant.disposal-due`.
