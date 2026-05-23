# @holon/api-contract

Zod schemas + OpenAPI definition for the Holon BFF contract.

Per `docs/decisions/001-bff-and-iteration-shape.md`, this package is the
contract between the React UI (UI mock in iter-001; real Next.js in iter-003+)
and the core domain services (`packages/core`, lands in iter-003+).

## Layout

```
src/
├── primitives.ts    # idOf(prefix), zIsoDateTime, base32 helpers
├── enums.ts         # substrate, autonomy_level, mission_state, etc.
├── entities/        # one file per domain entity (matches data-model.md § 4)
├── endpoints/       # one file per UI screen; Request + Response schemas
└── index.ts         # barrel re-export

tests/
└── fixtures.test.ts # validates src/ui-mock/_shared/fixtures.snapshot.json
                      # against the entity schemas — proves the contract
                      # matches what the UI mock was built against

scripts/
└── generate-openapi.ts  # walks endpoint registry → emits
                          # apis/holon-bff/openapi.yaml
```

## Scripts

```bash
pnpm -F api-contract typecheck   # tsc --noEmit
pnpm -F api-contract test        # vitest run (fixture conformance)
pnpm -F api-contract openapi     # regenerate apis/holon-bff/openapi.yaml
```

## How to add a new endpoint

1. If the endpoint introduces a new entity, add the Zod schema in
   `src/entities/<name>.ts` and re-export from `src/index.ts`.
2. Add the endpoint file in `src/endpoints/<screen>.ts`:
   - Export `Request`, `Response`, and (if needed) `Params` Zod schemas.
   - Register the route on the shared `OpenAPIRegistry` from
     `@asteasolutions/zod-to-openapi`.
3. Run `pnpm -F api-contract openapi` and commit the updated YAML.
4. Run `pnpm -F api-contract test` — fixture conformance must still pass.

## What this package is NOT

- Not the backend implementation. That's `packages/core` (iter-003+).
- Not the UI bindings. The Next.js app will import these schemas to
  parse responses, but the bindings live in `apps/web`.
- Not a database schema. That's `packages/db`. The BFF contract is the
  external surface; the DB schema is internal.
