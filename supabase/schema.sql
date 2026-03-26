-- Research phase v1
--
-- Supabase auth/users remain managed by Supabase auth.

create extension if not exists pgcrypto;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.research_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'collecting' check (status in ('collecting', 'review', 'confirmed', 'superseded', 'cancelled')),
  input_mode text not null default 'voice' check (input_mode in ('voice', 'text', 'mixed')),
  category text not null default 'unclear' check (category in ('banquet', 'coworking', 'clinic', 'adjacent', 'unclear')),
  scope_status text not null default 'unclear' check (scope_status in ('supported', 'adjacent', 'out_of_scope', 'unclear')),
  brief_json jsonb,
  resume_context jsonb,
  active_conversation_id text,
  last_event_seq integer not null default 0,
  started_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  superseded_at timestamptz
);

create table if not exists public.research_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.research_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seq integer not null,
  role text not null check (role in ('user', 'agent', 'system', 'tool')),
  modality text not null check (modality in ('voice', 'text', 'mixed')),
  content text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.research_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.research_sessions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  external_event_id text,
  kind text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists research_sessions_user_status_idx
  on public.research_sessions (user_id, status, updated_at desc);

create index if not exists research_messages_session_seq_idx
  on public.research_messages (session_id, seq);

create index if not exists research_events_session_created_idx
  on public.research_events (session_id, created_at desc);

create unique index if not exists research_events_session_kind_external_event_idx
  on public.research_events (session_id, kind, external_event_id);

drop trigger if exists set_research_sessions_updated_at on public.research_sessions;
create trigger set_research_sessions_updated_at
before update on public.research_sessions
for each row
execute function public.set_row_updated_at();

alter table public.research_sessions enable row level security;
alter table public.research_messages enable row level security;
alter table public.research_events enable row level security;

drop policy if exists research_sessions_select_own on public.research_sessions;
create policy research_sessions_select_own
on public.research_sessions
for select
using (auth.uid() = user_id);

drop policy if exists research_sessions_insert_own on public.research_sessions;
create policy research_sessions_insert_own
on public.research_sessions
for insert
with check (auth.uid() = user_id);

drop policy if exists research_sessions_update_own on public.research_sessions;
create policy research_sessions_update_own
on public.research_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists research_messages_select_own on public.research_messages;
create policy research_messages_select_own
on public.research_messages
for select
using (auth.uid() = user_id);

drop policy if exists research_messages_insert_own on public.research_messages;
create policy research_messages_insert_own
on public.research_messages
for insert
with check (auth.uid() = user_id);

drop policy if exists research_events_select_own on public.research_events;
create policy research_events_select_own
on public.research_events
for select
using (auth.uid() = user_id);

drop policy if exists research_events_insert_own on public.research_events;
create policy research_events_insert_own
on public.research_events
for insert
with check (auth.uid() = user_id or auth.role() = 'service_role');

-- Market, calls, winner, notifications

create table if not exists public.market_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  research_session_id uuid not null references public.research_sessions(id) on delete cascade,
  parent_run_id uuid references public.market_runs(id) on delete set null,
  supersedes_run_id uuid references public.market_runs(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'discovering', 'scraping', 'fallback_discovering', 'scoring', 'ready', 'needs_input', 'failed', 'cancelled', 'superseded')),
  current_stage text not null default 'idle' check (current_stage in ('idle', 'discovering', 'mapping', 'scraping', 'fallback_discovering', 'scoring', 'ready', 'needs_input', 'failed')),
  brief_snapshot_json jsonb not null default '{}'::jsonb,
  refinements_json jsonb not null default '[]'::jsonb,
  summary_json jsonb not null default '{}'::jsonb,
  error_text text,
  started_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  superseded_at timestamptz
);

create table if not exists public.market_provider_jobs (
  id uuid primary key default gen_random_uuid(),
  market_run_id uuid not null references public.market_runs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null,
  operation text not null,
  stage text not null,
  external_job_id text,
  status text not null default 'queued',
  request_json jsonb not null default '{}'::jsonb,
  response_json jsonb not null default '{}'::jsonb,
  last_event_type text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table if not exists public.market_candidates (
  id uuid primary key default gen_random_uuid(),
  market_run_id uuid not null references public.market_runs(id) on delete cascade,
  research_session_id uuid not null references public.research_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rank integer not null default 999,
  eligibility_status text not null default 'needs_review' check (eligibility_status in ('eligible', 'needs_review', 'ineligible')),
  selected_for_calls boolean not null default false,
  display_name text not null,
  canonical_url text,
  website_url text,
  phone text,
  whatsapp_number text,
  locality text,
  city text,
  address text,
  summary text,
  score double precision not null default 0,
  evidence_count integer not null default 0,
  score_breakdown_json jsonb,
  fit_notes_json jsonb not null default '[]'::jsonb,
  source_language text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.market_candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  market_run_id uuid not null references public.market_runs(id) on delete cascade,
  candidate_id uuid not null references public.market_candidates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null,
  source_domain text,
  source_kind text not null,
  is_first_party boolean not null default false,
  confidence double precision not null default 0.5,
  source_language text,
  excerpt text,
  fact_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.call_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  research_session_id uuid not null references public.research_sessions(id) on delete cascade,
  market_run_id uuid not null references public.market_runs(id) on delete cascade,
  transport text not null check (transport in ('synthetic_openai', 'elevenlabs_twilio', 'twilio_batch', 'whatsapp')),
  status text not null default 'queued' check (status in ('queued', 'preparing', 'active', 'completed', 'failed', 'cancelled')),
  display_language text not null default 'english' check (display_language in ('source', 'english')),
  source_language text,
  seed text not null,
  calling_policy_json jsonb not null default '{}'::jsonb,
  selection_fingerprint text not null default '',
  provider_state_json jsonb not null default '{}'::jsonb,
  playback_started_at timestamptz,
  playback_ends_at timestamptz,
  error_text text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  call_campaign_id uuid not null references public.call_campaigns(id) on delete cascade,
  market_run_id uuid not null references public.market_runs(id) on delete cascade,
  candidate_id uuid not null references public.market_candidates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_index integer not null default 0,
  status text not null default 'queued' check (status in ('queued', 'dialing', 'connected', 'negotiating', 'completed', 'no_answer', 'failed')),
  target_duration_ms integer not null default 0,
  actual_duration_ms integer,
  result text check (result in ('accepted', 'countered', 'refused', 'no_answer')),
  provider_call_id text,
  provider_conversation_id text,
  provider_state_json jsonb not null default '{}'::jsonb,
  call_plan_json jsonb not null default '{}'::jsonb,
  seller_scenario_json jsonb not null default '{}'::jsonb,
  artifact_json jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table if not exists public.call_turns (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seq integer not null,
  speaker text not null check (speaker in ('buyer', 'seller', 'system')),
  source_text text not null default '',
  english_text text not null default '',
  offset_ms integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.call_outcomes (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null unique references public.calls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  result text not null check (result in ('accepted', 'countered', 'refused', 'no_answer')),
  availability_status text not null default 'unknown',
  quoted_price integer,
  discount_offered integer,
  deposit_required boolean not null default false,
  hold_possible boolean not null default false,
  website_url text,
  whatsapp_number text,
  contact_name text,
  contact_channel text,
  confidence double precision not null default 0.5,
  summary_source_text text,
  summary_english_text text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.winner_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  research_session_id uuid not null references public.research_sessions(id) on delete cascade,
  market_run_id uuid not null references public.market_runs(id) on delete cascade,
  call_campaign_id uuid not null unique references public.call_campaigns(id) on delete cascade,
  selected_candidate_id uuid not null references public.market_candidates(id) on delete cascade,
  report_source_text text,
  report_english_text text,
  ranking_json jsonb not null default '[]'::jsonb,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  research_session_id uuid references public.research_sessions(id) on delete cascade,
  market_run_id uuid references public.market_runs(id) on delete cascade,
  call_campaign_id uuid references public.call_campaigns(id) on delete cascade,
  winner_artifact_id uuid references public.winner_artifacts(id) on delete set null,
  destination text not null,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.notification_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  provider text not null,
  status text not null check (status in ('pending', 'sent', 'failed', 'cancelled')),
  external_id text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists market_runs_user_research_updated_idx
  on public.market_runs (user_id, research_session_id, updated_at desc);

create index if not exists market_provider_jobs_run_external_idx
  on public.market_provider_jobs (market_run_id, external_job_id);

create index if not exists market_candidates_run_rank_idx
  on public.market_candidates (market_run_id, rank, score desc);

create unique index if not exists market_candidate_evidence_candidate_source_idx
  on public.market_candidate_evidence (candidate_id, source_url);

create index if not exists call_campaigns_user_market_updated_idx
  on public.call_campaigns (user_id, market_run_id, updated_at desc);

create index if not exists calls_campaign_order_idx
  on public.calls (call_campaign_id, order_index);

create index if not exists calls_provider_call_id_idx
  on public.calls (provider_call_id);

create index if not exists calls_provider_conversation_id_idx
  on public.calls (provider_conversation_id);

create unique index if not exists call_turns_call_seq_idx
  on public.call_turns (call_id, seq);

create index if not exists notification_requests_target_idx
  on public.notification_requests (user_id, channel, market_run_id, call_campaign_id, winner_artifact_id);

drop trigger if exists set_market_runs_updated_at on public.market_runs;
create trigger set_market_runs_updated_at
before update on public.market_runs
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_market_provider_jobs_updated_at on public.market_provider_jobs;
create trigger set_market_provider_jobs_updated_at
before update on public.market_provider_jobs
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_market_candidates_updated_at on public.market_candidates;
create trigger set_market_candidates_updated_at
before update on public.market_candidates
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_call_campaigns_updated_at on public.call_campaigns;
create trigger set_call_campaigns_updated_at
before update on public.call_campaigns
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_calls_updated_at on public.calls;
create trigger set_calls_updated_at
before update on public.calls
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_call_outcomes_updated_at on public.call_outcomes;
create trigger set_call_outcomes_updated_at
before update on public.call_outcomes
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_winner_artifacts_updated_at on public.winner_artifacts;
create trigger set_winner_artifacts_updated_at
before update on public.winner_artifacts
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_notification_requests_updated_at on public.notification_requests;
create trigger set_notification_requests_updated_at
before update on public.notification_requests
for each row
execute function public.set_row_updated_at();

alter table public.market_runs enable row level security;
alter table public.market_provider_jobs enable row level security;
alter table public.market_candidates enable row level security;
alter table public.market_candidate_evidence enable row level security;
alter table public.call_campaigns enable row level security;
alter table public.calls enable row level security;
alter table public.call_turns enable row level security;
alter table public.call_outcomes enable row level security;
alter table public.winner_artifacts enable row level security;
alter table public.notification_requests enable row level security;
alter table public.notification_deliveries enable row level security;

drop policy if exists market_runs_select_own on public.market_runs;
create policy market_runs_select_own
on public.market_runs for select
using (auth.uid() = user_id);

drop policy if exists market_runs_insert_own on public.market_runs;
create policy market_runs_insert_own
on public.market_runs for insert
with check (auth.uid() = user_id);

drop policy if exists market_runs_update_own on public.market_runs;
create policy market_runs_update_own
on public.market_runs for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists market_provider_jobs_select_own on public.market_provider_jobs;
create policy market_provider_jobs_select_own
on public.market_provider_jobs for select
using (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists market_provider_jobs_insert_service on public.market_provider_jobs;
create policy market_provider_jobs_insert_service
on public.market_provider_jobs for insert
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists market_provider_jobs_update_service on public.market_provider_jobs;
create policy market_provider_jobs_update_service
on public.market_provider_jobs for update
using (auth.uid() = user_id or auth.role() = 'service_role')
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists market_candidates_select_own on public.market_candidates;
create policy market_candidates_select_own
on public.market_candidates for select
using (auth.uid() = user_id);

drop policy if exists market_candidates_insert_own on public.market_candidates;
create policy market_candidates_insert_own
on public.market_candidates for insert
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists market_candidates_update_own on public.market_candidates;
create policy market_candidates_update_own
on public.market_candidates for update
using (auth.uid() = user_id or auth.role() = 'service_role')
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists market_candidate_evidence_select_own on public.market_candidate_evidence;
create policy market_candidate_evidence_select_own
on public.market_candidate_evidence for select
using (auth.uid() = user_id);

drop policy if exists market_candidate_evidence_insert_own on public.market_candidate_evidence;
create policy market_candidate_evidence_insert_own
on public.market_candidate_evidence for insert
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists call_campaigns_select_own on public.call_campaigns;
create policy call_campaigns_select_own
on public.call_campaigns for select
using (auth.uid() = user_id);

drop policy if exists call_campaigns_insert_own on public.call_campaigns;
create policy call_campaigns_insert_own
on public.call_campaigns for insert
with check (auth.uid() = user_id);

drop policy if exists call_campaigns_update_own on public.call_campaigns;
create policy call_campaigns_update_own
on public.call_campaigns for update
using (auth.uid() = user_id or auth.role() = 'service_role')
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists calls_select_own on public.calls;
create policy calls_select_own
on public.calls for select
using (auth.uid() = user_id);

drop policy if exists calls_insert_own on public.calls;
create policy calls_insert_own
on public.calls for insert
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists calls_update_own on public.calls;
create policy calls_update_own
on public.calls for update
using (auth.uid() = user_id or auth.role() = 'service_role')
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists call_turns_select_own on public.call_turns;
create policy call_turns_select_own
on public.call_turns for select
using (auth.uid() = user_id);

drop policy if exists call_turns_insert_own on public.call_turns;
create policy call_turns_insert_own
on public.call_turns for insert
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists call_outcomes_select_own on public.call_outcomes;
create policy call_outcomes_select_own
on public.call_outcomes for select
using (auth.uid() = user_id);

drop policy if exists call_outcomes_insert_own on public.call_outcomes;
create policy call_outcomes_insert_own
on public.call_outcomes for insert
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists call_outcomes_update_own on public.call_outcomes;
create policy call_outcomes_update_own
on public.call_outcomes for update
using (auth.uid() = user_id or auth.role() = 'service_role')
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists winner_artifacts_select_own on public.winner_artifacts;
create policy winner_artifacts_select_own
on public.winner_artifacts for select
using (auth.uid() = user_id);

drop policy if exists winner_artifacts_insert_own on public.winner_artifacts;
create policy winner_artifacts_insert_own
on public.winner_artifacts for insert
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists notification_requests_select_own on public.notification_requests;
create policy notification_requests_select_own
on public.notification_requests for select
using (auth.uid() = user_id);

drop policy if exists notification_requests_insert_own on public.notification_requests;
create policy notification_requests_insert_own
on public.notification_requests for insert
with check (auth.uid() = user_id);

drop policy if exists notification_requests_update_own on public.notification_requests;
create policy notification_requests_update_own
on public.notification_requests for update
using (auth.uid() = user_id or auth.role() = 'service_role')
with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists notification_deliveries_select_own on public.notification_deliveries;
create policy notification_deliveries_select_own
on public.notification_deliveries for select
using (auth.uid() = user_id);

drop policy if exists notification_deliveries_insert_service on public.notification_deliveries;
create policy notification_deliveries_insert_service
on public.notification_deliveries for insert
with check (auth.uid() = user_id or auth.role() = 'service_role');
