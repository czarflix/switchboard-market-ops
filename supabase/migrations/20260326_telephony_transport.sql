alter table public.call_campaigns
  add column if not exists selection_fingerprint text not null default '';

alter table public.call_campaigns
  add column if not exists provider_state_json jsonb not null default '{}'::jsonb;

alter table public.calls
  add column if not exists provider_call_id text;

alter table public.calls
  add column if not exists provider_conversation_id text;

alter table public.calls
  add column if not exists provider_state_json jsonb not null default '{}'::jsonb;

alter table public.call_campaigns
  drop constraint if exists call_campaigns_transport_check;

alter table public.call_campaigns
  add constraint call_campaigns_transport_check
  check (transport in ('synthetic_openai', 'elevenlabs_twilio', 'twilio_batch', 'whatsapp'));

create index if not exists calls_provider_call_id_idx
  on public.calls (provider_call_id);

create index if not exists calls_provider_conversation_id_idx
  on public.calls (provider_conversation_id);
