-- Cost metering: one row per billable-ish event (edge call, proxied tile,
-- upload, realtime minute, AI call). Written by edge functions (service role)
-- only. Read access for admins is added in phase 4 together with user_roles.

create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('edge_call', 'tile_proxy', 'storage_upload', 'realtime_minute', 'ai_call')),
  quantity integer not null default 1 check (quantity > 0),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index usage_events_created_at_idx on public.usage_events (created_at);
create index usage_events_user_created_idx on public.usage_events (user_id, created_at);

alter table public.usage_events enable row level security;

-- Deliberately no policies: anon and authenticated roles can neither read nor
-- write. The service role bypasses RLS. Do not add a permissive policy here;
-- the admin SELECT policy belongs in the user_roles migration (phase 4).

comment on table public.usage_events is
  'Cost metering. Written by edge functions only. Admin read policy comes with user_roles.';

revoke all on public.usage_events from anon, authenticated;
