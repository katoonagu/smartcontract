create table if not exists raw_evidence (
  id text primary key,
  source text not null,
  source_type text not null,
  chain text not null default 'tron',
  address text,
  tx_hash text,
  observed_transaction_hash text,
  evidence_json jsonb not null,
  created_at timestamptz not null default now()
);

alter table raw_evidence
  add column if not exists source text not null default 'unknown',
  add column if not exists source_type text not null default 'manual_input',
  add column if not exists chain text not null default 'tron',
  add column if not exists address text,
  add column if not exists tx_hash text,
  add column if not exists observed_transaction_hash text,
  add column if not exists evidence_json jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create table if not exists risk_signal_observations (
  id text primary key,
  subject_chain text not null default 'tron',
  subject_address text not null,
  subject_tx_hash text,
  observed_transaction_hash text,
  signal_group text not null,
  code text not null,
  message text not null,
  score_impact integer not null,
  confidence text not null,
  severity text not null,
  source text not null,
  policy_version text not null,
  raw_evidence_id text references raw_evidence(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table risk_signal_observations
  add column if not exists subject_chain text not null default 'tron',
  add column if not exists subject_address text not null default '',
  add column if not exists subject_tx_hash text,
  add column if not exists observed_transaction_hash text,
  add column if not exists signal_group text not null default 'manual',
  add column if not exists code text not null default 'unknown',
  add column if not exists message text not null default '',
  add column if not exists score_impact integer not null default 0,
  add column if not exists confidence text not null default 'medium',
  add column if not exists severity text not null default 'medium',
  add column if not exists source text not null default 'risk_engine',
  add column if not exists policy_version text not null default '2026-05-21-v1',
  add column if not exists raw_evidence_id text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'raw_evidence_source_type_check'
  ) then
    alter table raw_evidence
      add constraint raw_evidence_source_type_check
      check (source_type in ('internal_label', 'provider_response', 'detector_output', 'transfer_context', 'manual_input'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'risk_signal_observations_group_check'
  ) then
    alter table risk_signal_observations
      add constraint risk_signal_observations_group_check
      check (signal_group in ('internal_label', 'provider', 'graph', 'behavior', 'incoming_context', 'approval', 'manual'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'risk_signal_observations_confidence_check'
  ) then
    alter table risk_signal_observations
      add constraint risk_signal_observations_confidence_check
      check (confidence in ('low', 'medium', 'high'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'risk_signal_observations_severity_check'
  ) then
    alter table risk_signal_observations
      add constraint risk_signal_observations_severity_check
      check (severity in ('info', 'low', 'medium', 'high', 'critical'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'risk_signal_observations_raw_evidence_id_fkey'
  ) then
    alter table risk_signal_observations
      add constraint risk_signal_observations_raw_evidence_id_fkey
      foreign key (raw_evidence_id) references raw_evidence(id) on delete set null;
  end if;
end $$;

create index if not exists risk_signal_observations_subject_idx
  on risk_signal_observations(subject_chain, subject_address, created_at desc);

create index if not exists risk_signal_observations_tx_idx
  on risk_signal_observations(observed_transaction_hash);

create index if not exists raw_evidence_address_idx
  on raw_evidence(chain, address, created_at desc);
