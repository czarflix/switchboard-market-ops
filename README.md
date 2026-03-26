# Switchboard

One brief in. One winner out.

Switchboard is an AI sourcing desk for messy local vendor decisions. It captures a requirement, gathers live market evidence, organizes outreach, and returns one next-step-ready recommendation instead of another pile of tabs, notes, and follow-ups.

The point is not to add voice to a simple lookup. Voice matters where the brief is messy and where real people still need to be called. Firecrawl matters where pricing, availability, and contact signal are fragmented across the web. The workflow ends in a decision, not an answer.

The current demo uses banquet hall sourcing in Gurgaon, but the workflow is broader:

1. Capture the requirement through a voice-first intake
2. Sweep the live web for real market evidence
3. Build a ranked shortlist
4. Run outreach across shortlisted options
5. Lock one final winner with the next step already prepared

## Product Flow

- `/research`
  - voice-first intake and brief structuring
- `/market`
  - live market scan and evidence-backed shortlist
- `/calls`
  - parallel outreach and narrated lane updates
- `/winner`
  - final recommendation, export actions, and handoff

## Stack

- Next.js app router
- Supabase auth and relational state
- ElevenLabs / ElevenAgents for voice intake and narration
- Firecrawl Search + scrape for live web market intelligence
- OpenAI for workflow reasoning and structured artifacts
- Twilio as the live telephony transport when enabled
- Resend for email delivery

## Hosted Demo and Self-Hosted Telephony

The hosted demo is a gated review build. Its outbound-calling step is intentionally kept policy-safe because unrestricted public dialing creates spam, consent, and telephony-compliance risk. The hosted build still shows the intake, market, orchestration, and decision flow without exposing open calling.

Real live calling is for local, private, or self-hosted telephony-capable deployments only, with approved provider credentials, explicit operator control, and `LIVE_CALLS_ENABLED=true`. It should remain off by default.

Do not use live telephony without permission. Follow Twilio policy, consent and recording-disclosure requirements, sender registration rules, and local law. This is not for robocalling, spam, harassment, impersonation, or unsolicited bulk outreach.

## Live Demo

- Demo: [https://switchboard.czarflix.me](https://switchboard.czarflix.me)
- The hosted demo is a gated review build with the calls stage kept policy-safe.
- Judge access code will be published here after submissions close at 5:00 p.m. UK time on 26 March 2026.

## Local Development

```bash
pnpm install
pnpm dev
```

## Validation

```bash
pnpm typecheck
pnpm lint
pnpm build
```
