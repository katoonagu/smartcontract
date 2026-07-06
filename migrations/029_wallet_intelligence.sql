create table if not exists wallet_intelligence_runs (
  job_id text primary key references forensic_check_jobs(id) on delete cascade,
  job_kind text not null,
  job_status text not null,
  subject_address text not null,
  requested_by text,
  chat_id text,
  message_id text,
  completed_at timestamptz,
  telegram_user_id text,
  telegram_username text,
  telegram_locale text,
  source_payload_hash text not null,
  index_version integer not null,
  index_status text not null,
  index_error text,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wallet_intelligence_runs drop constraint if exists wallet_intelligence_runs_job_kind_check;
alter table wallet_intelligence_runs
  add constraint wallet_intelligence_runs_job_kind_check
  check (job_kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));

alter table wallet_intelligence_runs drop constraint if exists wallet_intelligence_runs_job_status_check;
alter table wallet_intelligence_runs
  add constraint wallet_intelligence_runs_job_status_check
  check (job_status in ('completed', 'partial'));

alter table wallet_intelligence_runs drop constraint if exists wallet_intelligence_runs_index_status_check;
alter table wallet_intelligence_runs
  add constraint wallet_intelligence_runs_index_status_check
  check (index_status in ('indexed', 'index_failed'));

create index if not exists wallet_intelligence_runs_subject_idx
  on wallet_intelligence_runs(subject_address, completed_at desc);

create index if not exists wallet_intelligence_runs_requester_idx
  on wallet_intelligence_runs(requested_by, completed_at desc);

create table if not exists wallet_intelligence_sightings (
  id text primary key,
  address text not null,
  job_id text not null references forensic_check_jobs(id) on delete cascade,
  job_kind text not null,
  subject_address text not null,
  requested_by text,
  source_kind text not null,
  role text not null,
  depth integer,
  path_id text,
  tx_hash text,
  amount_raw numeric(78, 0),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wallet_intelligence_sightings drop constraint if exists wallet_intelligence_sightings_job_kind_check;
alter table wallet_intelligence_sightings
  add constraint wallet_intelligence_sightings_job_kind_check
  check (job_kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));

alter table wallet_intelligence_sightings drop constraint if exists wallet_intelligence_sightings_source_kind_check;
alter table wallet_intelligence_sightings
  add constraint wallet_intelligence_sightings_source_kind_check
  check (source_kind in (
    'deep_direct_counterparty',
    'deep_second_layer',
    'where_origin_path',
    'where_source_provenance',
    'incoming_origin_path',
    'incoming_funding_bundle'
  ));

alter table wallet_intelligence_sightings drop constraint if exists wallet_intelligence_sightings_role_check;
alter table wallet_intelligence_sightings
  add constraint wallet_intelligence_sightings_role_check
  check (role in (
    'subject',
    'direct_counterparty',
    'second_hop',
    'source',
    'funder',
    'service_boundary',
    'contract',
    'unknown'
  ));

alter table wallet_intelligence_sightings drop constraint if exists wallet_intelligence_sightings_depth_check;
alter table wallet_intelligence_sightings
  add constraint wallet_intelligence_sightings_depth_check
  check (depth is null or depth >= 0);

create index if not exists wallet_intelligence_sightings_address_idx
  on wallet_intelligence_sightings(address, last_seen_at desc);

create index if not exists wallet_intelligence_sightings_job_idx
  on wallet_intelligence_sightings(job_id);

create index if not exists wallet_intelligence_sightings_subject_idx
  on wallet_intelligence_sightings(subject_address);

create index if not exists wallet_intelligence_sightings_requester_idx
  on wallet_intelligence_sightings(requested_by);

create index if not exists wallet_intelligence_sightings_tx_idx
  on wallet_intelligence_sightings(tx_hash)
  where tx_hash is not null;

create table if not exists wallet_intelligence_edges (
  id text primary key,
  from_address text not null,
  to_address text not null,
  job_id text not null references forensic_check_jobs(id) on delete cascade,
  job_kind text not null,
  source_kind text not null,
  depth integer,
  path_id text,
  tx_hash text,
  amount_raw numeric(78, 0),
  timestamp timestamptz,
  edge_role text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wallet_intelligence_edges drop constraint if exists wallet_intelligence_edges_job_kind_check;
alter table wallet_intelligence_edges
  add constraint wallet_intelligence_edges_job_kind_check
  check (job_kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));

alter table wallet_intelligence_edges drop constraint if exists wallet_intelligence_edges_source_kind_check;
alter table wallet_intelligence_edges
  add constraint wallet_intelligence_edges_source_kind_check
  check (source_kind in (
    'deep_direct_counterparty',
    'deep_second_layer',
    'where_origin_path',
    'where_source_provenance',
    'incoming_origin_path',
    'incoming_funding_bundle'
  ));

alter table wallet_intelligence_edges drop constraint if exists wallet_intelligence_edges_role_check;
alter table wallet_intelligence_edges
  add constraint wallet_intelligence_edges_role_check
  check (edge_role in ('transfer', 'context', 'funding', 'service_boundary'));

alter table wallet_intelligence_edges drop constraint if exists wallet_intelligence_edges_depth_check;
alter table wallet_intelligence_edges
  add constraint wallet_intelligence_edges_depth_check
  check (depth is null or depth >= 0);

create index if not exists wallet_intelligence_edges_from_idx
  on wallet_intelligence_edges(from_address, timestamp desc);

create index if not exists wallet_intelligence_edges_to_idx
  on wallet_intelligence_edges(to_address, timestamp desc);

create index if not exists wallet_intelligence_edges_job_idx
  on wallet_intelligence_edges(job_id);

create index if not exists wallet_intelligence_edges_tx_idx
  on wallet_intelligence_edges(tx_hash)
  where tx_hash is not null;

create table if not exists wallet_intelligence_address_summary (
  address text primary key,
  unique_subject_count integer not null default 0,
  unique_requester_count integer not null default 0,
  job_count integer not null default 0,
  completed_job_count integer not null default 0,
  partial_job_count integer not null default 0,
  occurrence_count integer not null default 0,
  distinct_tx_count integer not null default 0,
  distinct_amount_raw numeric(78, 0) not null default 0,
  min_depth integer,
  max_depth integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  modes jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  service_categories jsonb not null default '[]'::jsonb,
  label_hints jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists wallet_intelligence_address_summary_rank_idx
  on wallet_intelligence_address_summary(
    unique_subject_count desc,
    unique_requester_count desc,
    job_count desc,
    last_seen_at desc
  );

create index if not exists wallet_intelligence_address_summary_tags_idx
  on wallet_intelligence_address_summary using gin(tags);

create index if not exists wallet_intelligence_address_summary_categories_idx
  on wallet_intelligence_address_summary using gin(service_categories);
