-- user_devices table and RLS for push tokens

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android','ios')),
  token text not null,
  last_seen_at timestamptz not null default now(),
  app_version text,
  active boolean not null default true,
  unique (token)
);

create index if not exists idx_user_devices_user_active on public.user_devices (user_id, active);
create index if not exists idx_user_devices_token on public.user_devices (token);

alter table public.user_devices enable row level security;

-- RLS policies
drop policy if exists device_owner_rw on public.user_devices;
create policy device_owner_rw on public.user_devices
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


