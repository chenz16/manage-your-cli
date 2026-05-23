# APIs

This folder is where you (the human) drop external API specifications that Holon must integrate with.

## What goes here

- OpenAPI YAML / JSON specs for HTTP APIs
- GraphQL SDL files
- gRPC `.proto` files
- JSON Schema files for data formats
- Anything else that defines a contract Holon must honor

## Convention

One subfolder per API:

```
apis/
├── README.md
├── hermes/                 ← Hermes runtime API (when supplied)
│   └── openapi.yaml
├── stripe/                 ← if billing integration needs it
│   └── openapi.yaml
└── your-internal-api/
    └── ...
```

## How agents use these

The Dev Agent reads from `apis/` when implementing integrations. The Requirements Agent references API contracts when writing requirements that depend on external systems.

## Workflow For You (the human)

1. Drop the API spec file in a named subfolder.
2. Add a one-line description to this README's table below.
3. Mention the API in `requirements/current.md` so the Requirements Agent picks it up.

## Registered APIs

| Folder | What it is | Status |
|---|---|---|
| `holon-bff/` | Holon Backend-for-Frontend (machine-generated; see `packages/api-contract/`) | active — iter-002 |

## Holon-Internal APIs

Most Holon-internal APIs are specified in `docs/architecture/`:

- Cross-desk wire protocol → `docs/architecture/peer-communication-architecture.md` § 5
- Runtime adapter contract → `docs/architecture/runtime-adapter-interface.md`
- Desk-internal service APIs → `docs/architecture/implementation-architecture.md` § 7

### Exception: Holon BFF contract

The Holon BFF (the UI ↔ core-services contract per ADR-001) lives at
`apis/holon-bff/openapi.yaml`. It's machine-generated from the Zod
schemas in `packages/api-contract/` and committed so non-TS tooling
(Postman, Insomnia, codegen) can consume it directly.

Regenerate the BFF spec after any schema change:

```bash
pnpm -F api-contract openapi
```

This folder otherwise hosts THIRD-PARTY API contracts that Holon
integrates with.
