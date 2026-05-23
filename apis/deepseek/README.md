# DeepSeek API Integration

## Status

Available. API key is configured locally in `.env` (gitignored). The actual key is NOT in this repo.

## What It's For

DeepSeek is an LLM provider whose models can power local AI staff in Holon — used as one of the underlying LLMs the Hermes runtime adapter (`docs/architecture/runtime-adapter-interface.md`) can call when executing assignments.

In the abstract adapter interface, DeepSeek is a model BACKEND, not a runtime adapter. The runtime adapter (Hermes) decides what model to call; DeepSeek is one option.

## API Surface

DeepSeek's HTTP API is OpenAI-compatible. Base URL:

```
https://api.deepseek.com/v1
```

Common endpoints used:

- `POST /chat/completions` — chat / reasoning
- `POST /completions` — text completion (rarely used)
- `GET /models` — list available models

Models commonly referenced:

| Model | Use case |
|---|---|
| `deepseek-chat` | General chat / instruction following |
| `deepseek-reasoner` | Step-by-step reasoning tasks |
| `deepseek-coder` | Code-related tasks (V2) |

Reference: <https://api-docs.deepseek.com/>

## How To Use From Holon

The key lives in environment variable `DEEPSEEK_API_KEY` (loaded from `.env`).

In code (illustrative; will materialize in the runtime-hermes package later):

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

const completion = await client.chat.completions.create({
  model: "deepseek-chat",
  messages: [...],
});
```

## Security

- The API key is in `.env` (gitignored). NEVER commit it.
- If the key ever appears in a commit, rotate it immediately at <https://platform.deepseek.com/api_keys> and update `.env`.
- Production deployments should pass the key as an environment variable from the host's secrets manager (not from a `.env` file checked into a server image).
- Per `docs/architecture/auth-and-identity.md` § 11, the runtime adapter must NOT log model API responses verbatim (could contain PII / sensitive deliverable content).

## Cost / Rate Limits

DeepSeek's pricing: <https://api-docs.deepseek.com/quick_start/pricing>

Holon's runtime adapter respects per-job budget caps (`runtime-adapter-interface.md` § RuntimeJobConfig.budget). The adapter must:

- Track tokens used per call (`UsageEvent` per `runtime-adapter-interface.md` § RuntimeEvent)
- Cancel job with `BUDGET_EXCEEDED` if the cap is hit
- Surface cumulative usage in `DeliverableEvent.usage`

## Open Decisions

1. **Default model.** Should Holon default to `deepseek-chat` or `deepseek-reasoner` for new staff? Likely `deepseek-chat` as the cheaper option, with reasoner as opt-in for staff that need it.
2. **Fallback model.** When DeepSeek is unreachable, fall back to OpenAI / Anthropic? Or surface as `RUNTIME_UNREACHABLE` (per `reliability-and-testing.md` § 3) and let the owner decide?
3. **Streaming.** DeepSeek supports streaming completions; the runtime adapter should use streaming for low first-token latency (per `runtime-adapter-interface.md` § Latency Budget).

## Related Docs

- `docs/architecture/runtime-adapter-interface.md` — the abstract contract DeepSeek's usage must conform to
- `docs/architecture/reliability-and-testing.md` § 3 — error handling for API failures
- `apis/README.md` — overall third-party API integration philosophy
