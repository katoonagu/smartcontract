drop trigger unified_check_runs_rollout_policy_immutable
  on unified_check_runs;

drop function unified_reject_run_rollout_policy_mutation();

alter table unified_check_runs
  drop constraint unified_check_runs_rollout_policy_shape_check,
  drop constraint unified_check_runs_rollout_receipt_sha256_check,
  drop column rollout_receipt_sha256;

alter table unified_check_runs
  add constraint unified_check_runs_rollout_policy_shape_check
    check (
      (
        rollout_bucket is null
        and rollout_stage = 'global_barrier'
        and admission_policy = 'barrier'
        and provider_capacity_ceiling = 1
      )
      or
      (
        rollout_bucket is not null
        and (
          (rollout_stage = 'global_barrier' and admission_policy = 'barrier')
          or rollout_stage in ('isolated_rolling', 'bounded_user_check')
          or (rollout_stage = 'rolling_default' and admission_policy = 'rolling')
        )
      )
    );

create function unified_reject_run_rollout_policy_mutation()
returns trigger language plpgsql as $$
begin
  if new.rollout_stage is distinct from old.rollout_stage
    or new.rollout_bucket is distinct from old.rollout_bucket
    or new.admission_policy is distinct from old.admission_policy
    or new.provider_capacity_ceiling is distinct from old.provider_capacity_ceiling
  then
    raise exception 'unified_run_rollout_policy_immutable';
  end if;
  return new;
end;
$$;

create trigger unified_check_runs_rollout_policy_immutable
before update on unified_check_runs
for each row execute function unified_reject_run_rollout_policy_mutation();
