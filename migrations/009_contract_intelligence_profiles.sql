create table if not exists contract_intelligence_profiles (
  contract_address text primary key,
  provider_tags jsonb not null default '[]'::jsonb,
  public_tags jsonb not null default '[]'::jsonb,
  is_verified boolean,
  verify_status integer,
  source_status text,
  contract_created_at timestamptz,
  contract_age_days integer,
  tx_count bigint,
  recent_call_count bigint,
  total_call_count bigint,
  total_caller_count bigint,
  top_methods jsonb not null default '[]'::jsonb,
  top_callers jsonb not null default '[]'::jsonb,
  method_map jsonb not null default '{}'::jsonb,
  provider_risk boolean,
  raw_payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table contract_intelligence_profiles
  add column if not exists contract_address text,
  add column if not exists provider_tags jsonb not null default '[]'::jsonb,
  add column if not exists public_tags jsonb not null default '[]'::jsonb,
  add column if not exists is_verified boolean,
  add column if not exists verify_status integer,
  add column if not exists source_status text,
  add column if not exists contract_created_at timestamptz,
  add column if not exists contract_age_days integer,
  add column if not exists tx_count bigint,
  add column if not exists recent_call_count bigint,
  add column if not exists total_call_count bigint,
  add column if not exists total_caller_count bigint,
  add column if not exists top_methods jsonb not null default '[]'::jsonb,
  add column if not exists top_callers jsonb not null default '[]'::jsonb,
  add column if not exists method_map jsonb not null default '{}'::jsonb,
  add column if not exists provider_risk boolean,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb,
  add column if not exists fetched_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'contract_intelligence_profiles'
      and column_name = 'address'
  ) then
    execute 'update contract_intelligence_profiles set contract_address = address where contract_address is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_name = 'contract_intelligence_profiles'
      and column_name = 'verified'
  ) then
    execute 'update contract_intelligence_profiles set is_verified = verified where is_verified is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_name = 'contract_intelligence_profiles'
      and column_name = 'trx_count'
  ) then
    execute 'update contract_intelligence_profiles set tx_count = trx_count where tx_count is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_name = 'contract_intelligence_profiles'
      and column_name = 'unique_caller_count'
  ) then
    execute 'update contract_intelligence_profiles set total_caller_count = unique_caller_count where total_caller_count is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_name = 'contract_intelligence_profiles'
      and column_name = 'raw_json'
  ) then
    execute 'update contract_intelligence_profiles set raw_payload = raw_json where raw_payload = ''{}''::jsonb';
  end if;
end $$;

alter table contract_intelligence_profiles
  alter column contract_address set not null;

create unique index if not exists contract_intelligence_profiles_contract_address_idx
  on contract_intelligence_profiles(contract_address);

create index if not exists contract_intelligence_profiles_expires_at_idx
  on contract_intelligence_profiles(expires_at);
