create table if not exists forensic_cases (
  id text primary key,
  source_address text not null,
  target_address text not null,
  amount_usdt text,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table forensic_cases drop constraint if exists forensic_cases_status_check;
alter table forensic_cases
  add constraint forensic_cases_status_check
  check (status in ('completed', 'partial', 'failed'));

create table if not exists forensic_route_paths (
  id text primary key,
  case_id text not null references forensic_cases(id) on delete cascade,
  rank integer not null,
  score integer not null,
  confidence text not null,
  path_addresses jsonb not null,
  features jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  raw_evidence_id text references raw_evidence(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table forensic_route_paths drop constraint if exists forensic_route_paths_rank_check;
alter table forensic_route_paths
  add constraint forensic_route_paths_rank_check
  check (rank >= 1);

alter table forensic_route_paths drop constraint if exists forensic_route_paths_score_check;
alter table forensic_route_paths
  add constraint forensic_route_paths_score_check
  check (score >= 0 and score <= 100);

alter table forensic_route_paths drop constraint if exists forensic_route_paths_confidence_check;
alter table forensic_route_paths
  add constraint forensic_route_paths_confidence_check
  check (confidence in ('low', 'medium', 'high'));

create table if not exists forensic_route_edges (
  id text primary key,
  path_id text not null references forensic_route_paths(id) on delete cascade,
  from_address text not null,
  to_address text not null,
  tx_hash text not null,
  amount_raw text not null,
  timestamp timestamptz not null,
  method text not null,
  edge_type text not null,
  created_at timestamptz not null default now()
);

alter table forensic_route_edges drop constraint if exists forensic_route_edges_edge_type_check;
alter table forensic_route_edges
  add constraint forensic_route_edges_edge_type_check
  check (edge_type in ('normal_transfer', 'transfer_from', 'unknown'));

create index if not exists forensic_cases_addresses_idx
  on forensic_cases(source_address, target_address, created_at desc);

create index if not exists forensic_route_paths_case_idx
  on forensic_route_paths(case_id, rank asc);

create index if not exists forensic_route_edges_path_idx
  on forensic_route_edges(path_id);

create index if not exists forensic_route_edges_tx_idx
  on forensic_route_edges(tx_hash);
