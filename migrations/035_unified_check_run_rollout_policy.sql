alter table unified_check_runs
  add column rollout_stage text not null default 'global_barrier',
  add column rollout_bucket integer,
  add column admission_policy text not null default 'barrier',
  add column provider_capacity_ceiling integer not null default 1,
  add column rollout_receipt_sha256 text;

alter table unified_check_runs
  add constraint unified_check_runs_rollout_stage_check
    check (rollout_stage in (
      'global_barrier',
      'isolated_rolling',
      'bounded_user_check',
      'rolling_default'
    )),
  add constraint unified_check_runs_rollout_bucket_check
    check (rollout_bucket is null or rollout_bucket between 0 and 9999),
  add constraint unified_check_runs_admission_policy_check
    check (admission_policy in ('barrier', 'rolling')),
  add constraint unified_check_runs_provider_capacity_ceiling_check
    check (provider_capacity_ceiling between 1 and 100),
  add constraint unified_check_runs_rollout_receipt_sha256_check
    check (
      rollout_receipt_sha256 is null
      or rollout_receipt_sha256 ~ '^[0-9a-f]{64}$'
    ),
  add constraint unified_check_runs_rollout_policy_shape_check
    check (
      (rollout_receipt_sha256 is null
        and rollout_stage = 'global_barrier'
        and admission_policy = 'barrier'
        and provider_capacity_ceiling = 1)
      or
      (rollout_bucket is not null
        and rollout_receipt_sha256 is not null)
    );

create function unified_reject_run_rollout_policy_mutation()
returns trigger language plpgsql as $$
begin
  if new.rollout_stage is distinct from old.rollout_stage
    or new.rollout_bucket is distinct from old.rollout_bucket
    or new.admission_policy is distinct from old.admission_policy
    or new.provider_capacity_ceiling is distinct from old.provider_capacity_ceiling
    or new.rollout_receipt_sha256 is distinct from old.rollout_receipt_sha256
  then
    raise exception 'unified_run_rollout_policy_immutable';
  end if;
  return new;
end;
$$;

create trigger unified_check_runs_rollout_policy_immutable
before update on unified_check_runs
for each row execute function unified_reject_run_rollout_policy_mutation();
