create table if not exists address_metadata (
  address text primary key,
  source text not null check (source in ('tronscan')),
  name text,
  tag text,
  is_contract boolean,
  verified boolean,
  account_type integer,
  raw_json jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists address_metadata_expires_at_idx
  on address_metadata(expires_at);
