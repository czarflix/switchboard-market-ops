# Threat model

## Assets

- User identity and tenant boundaries.
- Sourcing briefs, contact details, and research evidence.
- Provider credentials and webhook secrets.
- Stored transcripts, recordings, and generated recommendations.

## Trust boundaries

1. Browser to authenticated Next.js route.
2. Next.js route to Supabase.
3. Server to Firecrawl, model, voice, email, and telephony providers.
4. Provider webhooks back to server routes.

## Threats and controls

| Threat | Control in the current design | Residual risk |
|---|---|---|
| Cross-user data access | Authenticated route helpers and Supabase row policies are part of the application design | Policies require deployment-level verification for every table and migration |
| Prompt injection in web evidence | Evidence is treated as data and the model receives structured workflow context | No benchmark currently proves resistance across all retrieved pages |
| Forged webhooks | Webhook secrets and provider-specific verification helpers | Configuration and replay protection must be tested in the deployed environment |
| Accidental outbound calls | Hosted demo disables live calls; live mode is an explicit environment flag | A private operator could still enable a real provider without a separate approval workflow |
| Secret exposure | Secrets are documented as environment values and excluded from the repository | Existing public history and deployment settings require periodic rescanning |
| Unsafe external action | Winner/export stages are reviewable; recovery defaults to dry-run | The application does not replace operator judgment or provider policy |

## Security test priorities

- Tenant isolation and row-level policy tests.
- Webhook signature, timestamp, and replay tests.
- Prompt-injection fixtures embedded in retrieved pages.
- Rate limits and file/URL size limits for ingestion.
- Confirmation boundaries for calls, messages, purchases, and exports.
