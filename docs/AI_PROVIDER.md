# AI providers, failover and health

## Providers
- **Primary: DeepSeek** (`providers/llm/deepseek.py`), `deepseek-flash` (V4.1-Flash, with vision). Thinking is off
  by default and turned on per request (Settings → Thinking).
- **Backup: any OpenAI-compatible Chat Completions API** (`providers/llm/openai_compat.py`), such as OpenAI,
  Gemini's OpenAI endpoint, OpenRouter, Groq or Together. It's off until configured.
- **Mock** (`providers/llm/mock.py`) for keyless development and tests. It's labelled `mock` everywhere and never
  used in production.

All keys live only in the API process.

## Failover (`providers/llm/fallback.py`)
`get_llm_provider()` always wraps DeepSeek in `FallbackProvider`:

```
request → circuit breaker closed? → DeepSeek ── first token within budget ──► stream (never switches after this)
                    │                   │
                    │                   └─ fails before its first token (429 · 5xx · timeout · network ·
                    │                      401/402/403) → backup, if configured and allowed
                    └─ open (3 straight failures, 30 s) ───────────────► backup directly; then one trial
```

- **First-token budget:** `ORBIT_LLM_FIRST_TOKEN_TIMEOUT_S` (10 s), plus 12 s when thinking is on.
- **No switching mid-answer:** once DeepSeek has streamed text, a failure surfaces as a failed answer (and the
  engine's one retry). Two models are never spliced into one answer.
- **Not failed over:**
  - bad requests (400);
  - images when the backup has no vision (`ORBIT_FALLBACK_LLM_VISION`);
  - plans without the `provider_fallback` feature (Free by default; see BILLING.md).
- **Attribution:** the first chunk of every stream names the provider and model that served it. Answers and
  `provider_requests` rows record the real one, so cost is priced against the backup's model. Give it a price in
  `ORBIT_LLM_PRICING_JSON`, or its cost is logged as unknown (`NULL`), never as zero.
- **What the user sees:** nothing technical. A failover shows no error and sends
  `provider.status {state: "ok", detail: "AI connection recovered"}`. Provider names and HTTP codes stay in
  server logs and admin diagnostics.

### Configure a backup
```bash
ORBIT_FALLBACK_LLM_BASE_URL=https://api.openai.com/v1      # or https://generativelanguage.googleapis.com/v1beta/openai
ORBIT_FALLBACK_LLM_API_KEY=...
ORBIT_FALLBACK_LLM_MODEL=gpt-4o-mini                       # or gemini-2.5-flash, …
ORBIT_FALLBACK_LLM_NAME=openai                             # label in logs/cost rows
ORBIT_FALLBACK_LLM_VISION=true                             # only if the model reads images
ORBIT_FALLBACK_LLM_EXTRA_JSON='{"reasoning_effort": "low"}' # provider options merged into every request
ORBIT_LLM_PRICING_JSON='{"gpt-4o-mini": {"cache_miss": 0.15, "cache_hit": 0.075, "output": 0.6}}'
```
Production refuses a backup URL that isn't `https://`, a URL without a key or model, or extra options that aren't
a JSON object.

**Thinking models need `EXTRA_JSON`.** A model that reasons by default spends the answer's token budget before
writing, and answers come out cut short. This was seen for real with DeepSeek as the backup, and fixed with
`{"thinking": {"type": "disabled"}}`.

Verified live: with the primary pointed at a dead address, the backup client streamed a real answer from
DeepSeek's OpenAI-compatible endpoint in 3.0 s, and health showed the primary degraded (`network`) and the backup
healthy.

## Provider health (`providers/health.py`)
Outcomes are recorded for:
- the LLM primary and backup;
- Deepgram handshakes;
- the database (`/ready`);
- email sends.

Each dependency is **healthy**, **degraded** (at least 20% failures in the last 15 minutes, or a slow p95),
**down** (the last 3 attempts all failed) or **unknown**.
- **Admins:** `GET /v1/admin/providers` shows the detail (last success and failure, last error code, p95, failure
  rate) and the failover state (breaker, budget).
- **Users:** only friendly summaries. Preflight pings DeepSeek directly, not through the failover, and reports
  "DeepSeek unavailable; the backup AI is answering" as a warning when the backup works.

Health is in-process, like the rest of live state (one API instance, D12).
