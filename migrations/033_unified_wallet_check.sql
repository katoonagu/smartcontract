create table unified_check_runs (
  id text primary key,
  analysis_key_sha256 text not null,
  subject_address text not null,
  status text not null,
  status_reason text,
  run_purpose text not null,
  side_effect_policy text not null,
  analysis_manifest_sha256 text not null,
  final_score integer,
  final_decision text,
  evidence_bundle_sha256 text,
  traversal_closure_sha256 text,
  scoring_bundle_sha256 text,
  report_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (status in (
    'RUNNING','WAITING_FOR_PROVIDER','BLOCKED_ADMIN',
    'FINALIZING','COMPLETED','FAILED_TECHNICAL'
  )),
  check (run_purpose in (
    'user_check','admin_diagnostic','release_canary',
    'synthetic_test','maintenance'
  )),
  check (side_effect_policy in ('authoritative','isolated')),
  check (run_purpose <> 'release_canary' or side_effect_policy = 'isolated'),
  check (final_score is null or final_score between 0 and 100),
  check (
    status <> 'COMPLETED' or
    (final_score is not null and final_decision in ('ACCEPTABLE','REVIEW','DECLINE')
      and evidence_bundle_sha256 is not null
      and traversal_closure_sha256 is not null
      and scoring_bundle_sha256 is not null
      and report_sha256 is not null)
  )
);

create unique index unified_check_runs_reusable_analysis_idx
  on unified_check_runs(analysis_key_sha256)
  where status <> 'FAILED_TECHNICAL';

create table unified_check_requests (
  id text primary key,
  request_correlation_id text not null unique,
  run_id text references unified_check_runs(id),
  subject_address text not null,
  chat_id text not null,
  message_thread_id text not null default '',
  locale text not null,
  run_purpose text not null,
  side_effect_policy text not null,
  status text not null,
  status_reason text,
  ready_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (locale in ('ru','en')),
  check (run_purpose in (
    'user_check','admin_diagnostic','release_canary',
    'synthetic_test','maintenance'
  )),
  check (side_effect_policy in ('authoritative','isolated')),
  check (run_purpose <> 'release_canary' or side_effect_policy = 'isolated'),
  check (status in ('ACCEPTED','ATTACHED','FAILED_TECHNICAL')),
  check (
    (status = 'ATTACHED' and run_id is not null)
    or (status <> 'ATTACHED' and run_id is null)
  )
);

create table unified_check_tasks (
  id text primary key,
  run_id text not null references unified_check_runs(id),
  kind text not null,
  status text not null,
  priority_lane text not null,
  ready_at timestamptz not null default now(),
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempt integer not null default 0,
  accepted_attempt_id text,
  logical_key text not null default 'main',
  checkpoint_json jsonb not null default '{}'::jsonb,
  cancellation_requested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, kind, logical_key)
);

create table unified_check_artifacts (
  sha256 text primary key,
  created_by_run_id text not null references unified_check_runs(id),
  kind text not null,
  schema_version text not null,
  artifact_json jsonb not null,
  created_at timestamptz not null default now()
);

create table unified_check_attempts (
  id text primary key,
  task_id text not null references unified_check_tasks(id),
  attempt integer not null,
  artifact_sha256 text not null references unified_check_artifacts(sha256),
  completed_at timestamptz not null,
  unique (task_id, attempt)
);

alter table unified_check_tasks
  add constraint unified_check_tasks_accepted_attempt_fk
  foreign key (accepted_attempt_id) references unified_check_attempts(id);

create table unified_check_deliveries (
  id text primary key,
  request_id text not null references unified_check_requests(id),
  presentation_sha256 text not null,
  status text not null,
  lease_token text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  telegram_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, presentation_sha256)
);

create table unified_provider_pages (
  request_identity_sha256 text primary key,
  snapshot_block_hash text not null,
  payload_sha256 text not null,
  payload_json jsonb not null,
  fetched_at timestamptz not null,
  provenance_json jsonb not null
);

create table unified_label_datasets (
  sha256 text primary key,
  dataset_json jsonb not null,
  created_at timestamptz not null default now(),
  check (sha256 ~ '^[0-9a-f]{64}$')
);

create table unified_check_generation_fence (
  generation_id text primary key,
  activated_at timestamptz not null,
  runtime_commit text not null,
  delivery_generation text not null,
  active boolean not null,
  created_at timestamptz not null default now()
);

create unique index unified_check_generation_fence_one_active_idx
  on unified_check_generation_fence ((active))
  where active = true;

create table unified_wallet_delivery_ownership (
  subject_address text not null,
  chat_id text not null,
  generation_id text not null
    references unified_check_generation_fence(generation_id),
  acquired_at timestamptz not null,
  primary key (subject_address, chat_id)
);

alter table unified_check_tasks
  add constraint unified_check_tasks_status_check
  check (status in (
    'QUEUED','LEASED','WAITING_RETRY','COMPLETED',
    'BLOCKED_ADMIN','FAILED_TECHNICAL','CANCELLED'
  )),
  add constraint unified_check_tasks_lane_check
  check (priority_lane in ('interactive','repair','background')),
  add constraint unified_check_tasks_lease_shape_check
  check (
    (status = 'LEASED' and lease_owner is not null and lease_token is not null
      and lease_expires_at is not null)
    or
    (status <> 'LEASED' and lease_owner is null and lease_token is null
      and lease_expires_at is null)
  );

alter table unified_check_deliveries
  add constraint unified_check_deliveries_status_check
  check (status in (
    'PENDING','LEASED','RETRYABLE','SENT_CONFIRMED',
    'DELIVERY_UNKNOWN','BLOCKED_ADMIN','CANCELLED'
  ));

alter table unified_check_runs
  add constraint unified_check_runs_hash_shape_check
  check (
    analysis_key_sha256 ~ '^[0-9a-f]{64}$'
    and analysis_manifest_sha256 ~ '^[0-9a-f]{64}$'
  );

create index unified_check_tasks_claim_idx
  on unified_check_tasks(status, priority_lane, ready_at, created_at)
  where status in ('QUEUED','WAITING_RETRY');

create index unified_check_deliveries_claim_idx
  on unified_check_deliveries(status, next_attempt_at, updated_at)
  where status in ('PENDING','RETRYABLE');

create function unified_reject_immutable_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'unified_immutable_artifact_mutation';
end;
$$;

create trigger unified_check_attempts_immutable
before update or delete on unified_check_attempts
for each row execute function unified_reject_immutable_mutation();

create trigger unified_check_artifacts_immutable
before update or delete on unified_check_artifacts
for each row execute function unified_reject_immutable_mutation();

create trigger unified_provider_pages_immutable
before update or delete on unified_provider_pages
for each row execute function unified_reject_immutable_mutation();

create trigger unified_label_datasets_immutable
before update or delete on unified_label_datasets
for each row execute function unified_reject_immutable_mutation();

create trigger unified_wallet_delivery_ownership_immutable
before update or delete on unified_wallet_delivery_ownership
for each row execute function unified_reject_immutable_mutation();
