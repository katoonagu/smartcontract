alter table address_labels drop constraint if exists address_labels_label_check;
alter table address_labels
  add constraint address_labels_label_check
  check (label in (
    'scam', 'reported_scam', 'victim', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge',
    'exchange', 'trusted', 'false_positive', 'needs_review', 'mixer_like',
    'risky_contract', 'whitebit', 'darknet_exchange', 'darknet_exchange_proximity',
    'approval_drain_proximity'
  ));

alter table transaction_labels drop constraint if exists transaction_labels_label_check;
alter table transaction_labels
  add constraint transaction_labels_label_check
  check (label in (
    'scam', 'reported_scam', 'victim', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge',
    'exchange', 'trusted', 'false_positive', 'needs_review', 'mixer_like',
    'risky_contract', 'whitebit', 'darknet_exchange', 'darknet_exchange_proximity',
    'approval_drain_proximity'
  ));

create table if not exists address_label_assertions (
  id text primary key,
  chain text not null,
  address text not null,
  label text not null,
  entity_name text,
  category text not null,
  confidence text not null,
  severity text not null,
  status text not null,
  source_name text not null,
  source_url text,
  notes text,
  evidence_json jsonb not null default '{}'::jsonb,
  created_by_telegram_id text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table address_label_assertions drop constraint if exists address_label_assertions_label_check;
alter table address_label_assertions
  add constraint address_label_assertions_label_check
  check (label in (
    'scam', 'reported_scam', 'victim', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge',
    'exchange', 'trusted', 'false_positive', 'needs_review', 'mixer_like',
    'risky_contract', 'whitebit', 'darknet_exchange', 'darknet_exchange_proximity',
    'approval_drain_proximity'
  ));

alter table address_label_assertions drop constraint if exists address_label_assertions_confidence_check;
alter table address_label_assertions
  add constraint address_label_assertions_confidence_check
  check (confidence in ('low', 'medium', 'high'));

alter table address_label_assertions drop constraint if exists address_label_assertions_severity_check;
alter table address_label_assertions
  add constraint address_label_assertions_severity_check
  check (severity in ('info', 'low', 'medium', 'high', 'critical'));

alter table address_label_assertions drop constraint if exists address_label_assertions_status_check;
alter table address_label_assertions
  add constraint address_label_assertions_status_check
  check (status in ('active', 'inactive', 'retired', 'false_positive'));

create index if not exists address_label_assertions_address_status_idx
  on address_label_assertions(chain, address, status);

create index if not exists address_label_assertions_label_status_idx
  on address_label_assertions(label, status);

create index if not exists address_label_assertions_category_status_idx
  on address_label_assertions(category, status);

insert into address_label_assertions (
  id, chain, address, label, entity_name, category, confidence, severity,
  status, source_name, source_url, notes, evidence_json,
  created_by_telegram_id, first_seen_at, last_seen_at
) values (
  'manual_seed_tron_darknet_exchange_tyfk_2026_05_24',
  'tron',
  'TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV',
  'darknet_exchange',
  'Manual darknet exchange seed',
  'darknet_exchange',
  'high',
  'critical',
  'active',
  'manual_verified',
  null,
  'Manually verified darknet exchange seed.',
  '{"source":"manual_verified","phase":"10A.6"}'::jsonb,
  null,
  now(),
  now()
) on conflict (id) do update set
  chain = excluded.chain,
  address = excluded.address,
  label = excluded.label,
  entity_name = excluded.entity_name,
  category = excluded.category,
  confidence = excluded.confidence,
  severity = excluded.severity,
  status = excluded.status,
  source_name = excluded.source_name,
  source_url = excluded.source_url,
  notes = excluded.notes,
  evidence_json = excluded.evidence_json,
  last_seen_at = excluded.last_seen_at,
  updated_at = now();

insert into address_labels (address, label, source, created_by_telegram_id)
values (
  'TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV',
  'darknet_exchange',
  'service_admin',
  null
) on conflict (address, label) do update set
  source = excluded.source,
  created_by_telegram_id = excluded.created_by_telegram_id;
