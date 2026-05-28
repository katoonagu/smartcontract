create table if not exists contract_llm_verdict_cache (
  id text primary key,
  contract_address text not null,
  profile_hash text not null,
  contract_fingerprint_hash text not null,
  case_file_hash text not null,
  policy_version text not null,
  provider_label text not null,
  model text not null,
  verdict_json jsonb not null default '{}'::jsonb,
  request_case_hash text not null,
  response_json jsonb not null default '{}'::jsonb,
  error text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists contract_llm_verdict_cache_lookup_idx
  on contract_llm_verdict_cache(contract_address, profile_hash, policy_version, model);

create index if not exists contract_llm_verdict_cache_fingerprint_idx
  on contract_llm_verdict_cache(contract_fingerprint_hash, policy_version, model, updated_at desc);

create index if not exists contract_llm_verdict_cache_expires_at_idx
  on contract_llm_verdict_cache(expires_at);
