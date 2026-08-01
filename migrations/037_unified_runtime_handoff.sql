create table unified_runtime_instances (
  instance_id text primary key,
  runtime_commit text not null,
  instance_label text not null,
  state text not null,
  started_at timestamptz not null,
  heartbeat_at timestamptz not null,
  drain_requested_at timestamptz,
  drain_deadline_at timestamptz,
  telegram_polling_released_at timestamptz,
  stopped_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unified_runtime_instances_commit_check
    check (runtime_commit ~ '^[0-9a-f]{40}$'),
  constraint unified_runtime_instances_label_check
    check (btrim(instance_label) <> ''),
  constraint unified_runtime_instances_state_check
    check (state in ('ACTIVE','DRAIN_REQUESTED','DRAINING','STOPPED')),
  constraint unified_runtime_instances_failure_reason_check
    check (failure_reason is null or failure_reason in (
      'heartbeat_timeout','graceful_exit','shutdown_failure'
    )),
  constraint unified_runtime_instances_state_shape_check check (
    (state = 'ACTIVE' and drain_requested_at is null
      and drain_deadline_at is null
      and telegram_polling_released_at is null and stopped_at is null)
    or (state = 'DRAIN_REQUESTED' and drain_requested_at is not null
      and drain_deadline_at is not null
      and telegram_polling_released_at is null and stopped_at is null)
    or (state = 'DRAINING' and drain_requested_at is not null
      and drain_deadline_at is not null
      and telegram_polling_released_at is not null and stopped_at is null)
    or (state = 'STOPPED' and stopped_at is not null)
  ),
  constraint unified_runtime_instances_deadline_order_check check (
    drain_deadline_at is null or drain_requested_at is null
      or drain_deadline_at > drain_requested_at
  )
);

create unique index unified_runtime_instances_one_intake_owner_idx
  on unified_runtime_instances ((true))
  where state in ('ACTIVE','DRAIN_REQUESTED')
    and telegram_polling_released_at is null;

create index unified_runtime_instances_compatible_drainer_idx
  on unified_runtime_instances(runtime_commit, heartbeat_at, drain_deadline_at)
  where state = 'DRAINING';

create table unified_check_notifications (
  id text primary key,
  request_id text not null references unified_check_requests(id),
  kind text not null,
  locale text not null,
  copy_version text not null,
  status text not null,
  ready_at timestamptz not null,
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  telegram_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, kind),
  constraint unified_check_notifications_kind_check check (
    kind in ('LONG_RUNNING','FAILED_TECHNICAL_RUNTIME_HANDOFF')
  ),
  constraint unified_check_notifications_locale_check
    check (locale in ('ru','en')),
  constraint unified_check_notifications_copy_check
    check (copy_version = 'unified-lifecycle-copy-v1'),
  constraint unified_check_notifications_status_check check (
    status in ('PENDING','LEASED','RETRYABLE','SENT_CONFIRMED',
      'DELIVERY_UNKNOWN','CANCELLED')
  ),
  constraint unified_check_notifications_lease_shape_check check (
    (status = 'LEASED' and lease_token is not null
      and lease_expires_at is not null)
    or (status <> 'LEASED' and lease_token is null
      and lease_expires_at is null)
  ),
  constraint unified_check_notifications_retry_shape_check check (
    (status = 'RETRYABLE' and next_attempt_at is not null)
    or (status <> 'RETRYABLE' and next_attempt_at is null)
  )
);

create index unified_check_notifications_claim_idx
  on unified_check_notifications(
    status, (coalesce(next_attempt_at, ready_at)), created_at
  )
  where status in ('PENDING','RETRYABLE');

do $$
declare request_shape_constraint text;
begin
  select c.conname into request_shape_constraint
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = current_schema()
     and t.relname = 'unified_check_requests'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%status%ATTACHED%run_id%'
   limit 1;
  if request_shape_constraint is null then
    raise exception 'unified_check_requests_run_shape_constraint_missing';
  end if;
  execute format(
    'alter table unified_check_requests drop constraint %I',
    request_shape_constraint
  );
end $$;

alter table unified_check_requests
  add constraint unified_check_requests_run_shape_check check (
    (status = 'ATTACHED' and run_id is not null)
    or status = 'FAILED_TECHNICAL'
    or (status not in ('ATTACHED','FAILED_TECHNICAL') and run_id is null)
  );
