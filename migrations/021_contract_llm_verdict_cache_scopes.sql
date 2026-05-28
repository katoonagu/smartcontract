alter table contract_llm_verdict_cache
  add column if not exists cache_scope text not null default 'address_flow',
  add column if not exists flow_context_hash text;

drop index if exists contract_llm_verdict_cache_lookup_idx;

create index if not exists contract_llm_verdict_cache_lookup_idx
  on contract_llm_verdict_cache(contract_address, profile_hash, cache_scope, flow_context_hash, policy_version, model, updated_at desc);

create index if not exists contract_llm_verdict_cache_scope_fingerprint_idx
  on contract_llm_verdict_cache(cache_scope, contract_fingerprint_hash, flow_context_hash, policy_version, model, updated_at desc);
