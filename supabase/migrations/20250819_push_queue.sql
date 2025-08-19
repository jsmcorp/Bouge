-- Notification queue to decouple DB writes from push fanout

create table if not exists public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  group_id uuid not null,
  sender_id uuid not null,
  created_at timestamptz not null,
  enqueued_at timestamptz not null default now(),
  processed_at timestamptz,
  attempt_count int not null default 0
);

create index if not exists idx_notification_queue_unprocessed on public.notification_queue (processed_at) where processed_at is null;
create index if not exists idx_notification_queue_group on public.notification_queue (group_id);

-- Trigger function to enqueue on message insert
create or replace function public.enqueue_notification_on_message()
returns trigger as $$
begin
  insert into public.notification_queue (message_id, group_id, sender_id, created_at)
  values (new.id, new.group_id, new.user_id, new.created_at);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_enqueue_notification_on_message on public.messages;
create trigger trg_enqueue_notification_on_message
after insert on public.messages
for each row execute function public.enqueue_notification_on_message();


