-- Durable cache for proxy-fetch. Edge-function isolates do not share memory
-- between invocations, so an in-memory cache alone never hits across users.
-- Written and read by the service role only (edge functions).

create table public.proxy_cache (
  cache_key text primary key,
  body text not null,
  content_type text not null,
  last_modified text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index proxy_cache_expires_idx on public.proxy_cache (expires_at);

alter table public.proxy_cache enable row level security;
-- No policies on purpose: anon/authenticated can neither read nor write.
revoke all on public.proxy_cache from anon, authenticated;

comment on table public.proxy_cache is
  'Upstream responses cached by the proxy-fetch edge function. Service role only.';
