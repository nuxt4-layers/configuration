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

## Phase 3: composition (in progress)

- Done: reference adapters from Identity's directory and access governance, Authorisation's qualification and Authentication's principal; Identity's events applied once each (tenant states, and group and tenant disposal when due, never while deferred).
- Next: compose the layer with the real members in `steve-r-lewis/platform-test-harness`, so the host's type check proves the adapters fit and the pages run against the suite.
