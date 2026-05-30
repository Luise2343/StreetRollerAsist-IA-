# AI usage budget backend

## What was found

The local changes were implementing cost observability for OpenAI usage and a monthly budget guard per tenant.

Main findings before the fix:

- `OPENAI_MODEL` was changed to `gpt-5-mini`, but several second OpenAI calls in `src/services/ia.js` still sent `max_tokens`. GPT-5 style models require `max_completion_tokens`.
- Only the first agent completion was recorded. Follow-up completions after tool calls were missing from `ai_usage`, so budget usage could be undercounted.
- The new migration was named `004_ai_usage.sql`, while the repository already had several `004` migrations and later migrations up to `012`.
- Runtime docs still listed `gpt-4o-mini` as the default model.

## What was changed

- Renamed the migration to `migrations/013_ai_usage.sql`.
- Applied `maxTokensParam(model, limit)` to all follow-up OpenAI calls in `src/services/ia.js`.
- Recorded usage for follow-up completions after product search, lead classification, order dedupe, order creation, and owner notification.
- Kept summary/facts calls using `maxTokensParam()` and usage recording.
- Fixed the local lint issue in `src/services/ai-budget.js` caused by an unused initial assignment.
- Updated `README.md` and `docker-compose.yml` with the `gpt-5-mini` default and budget environment variables.

## Backend behavior

The backend records each OpenAI completion in `ai_usage` with:

- tenant id
- WhatsApp id when available
- model
- purpose (`agent`, `summary`, or `facts`)
- prompt, cached, completion, and total tokens
- estimated cost in USD

The monthly budget check uses the current calendar month. If the tenant reaches `AI_MONTHLY_BUDGET_USD`, the agent keeps responding but switches from the preferred model to `AI_FALLBACK_MODEL`.

Push notifications are sent at 80 percent and 100 percent of the budget when web push is configured.

## Required setup

Apply the migration before relying on the dashboard endpoint:

```bash
node scripts/apply-migrations.mjs migrations/013_ai_usage.sql
```

Relevant environment variables:

```bash
OPENAI_MODEL=gpt-5-mini
AI_MONTHLY_BUDGET_USD=5
AI_FALLBACK_MODEL=gpt-4o-mini
AI_BUDGET_CACHE_SEC=60
```

## Admin endpoint

`GET /admin/ai-usage?tenantId=3&range=30D`

Supported ranges are `1D`, `7D`, `30D`, and anything else falls back to `90D`.

The response includes:

- `budgetUsd`
- `monthCostUsd`
- `usedPct`
- `monthTokens`
- `byModel`
- `daily`

## Remaining notes

- The pricing table in `src/services/ai-pricing.js` is static. Review it when OpenAI pricing changes.
- If the migration is not applied, usage recording is fire-and-forget and will not break normal agent replies, but `/admin/ai-usage` can fail because it queries `ai_usage` directly.
- Existing lint/test failures outside this feature may still need cleanup before enforcing CI.
