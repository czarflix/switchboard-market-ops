# Evaluation plan

The repository includes deterministic audit and simulation scripts under `scripts/research-agent/`. They are intended to validate state transitions and recovery behavior without enabling live external actions.

## Required fixture classes

- Empty or underspecified sourcing brief.
- Conflicting evidence from two sources.
- Provider timeout and partial result.
- Duplicate candidate and stale run reconciliation.
- Prompt-injection text in a retrieved page.
- Unauthorized access to another user's run.
- Webhook with invalid signature or replayed timestamp.
- Live-calls-disabled policy boundary.

## Metrics to add before making performance claims

- Evidence retrieval recall at k.
- Citation precision and source validity.
- Structured-field extraction accuracy.
- Recommendation agreement with a labeled review set.
- Recovery success rate and time to recovery.
- Unauthorized-request rejection rate.

Until those measurements are checked into the repository, descriptions should use capability language rather than accuracy or production-usage claims.
