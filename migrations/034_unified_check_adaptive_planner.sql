alter table unified_check_runs
  add column fairness_owner_id text;

update unified_check_runs
  set fairness_owner_id = id;

alter table unified_check_runs
  alter column fairness_owner_id set not null,
  add constraint unified_check_runs_fairness_owner_not_blank_check
    check (btrim(fairness_owner_id) <> '');

alter table unified_check_tasks
  add constraint unified_check_tasks_run_id_id_key unique (run_id, id);

create table unified_check_planner_entries (
  run_id text not null references unified_check_runs(id),
  canonical_sequence bigint not null,
  task_id text not null,
  planner_state text not null,
  result_bytes bigint,
  admitted_at timestamptz,
  reserved_bytes bigint,
  planned_at timestamptz not null default statement_timestamp(),
  ready_at timestamptz,
  committed_at timestamptz,
  primary key (run_id, canonical_sequence),
  unique (run_id, task_id),
  constraint unified_check_planner_entries_run_task_fk
    foreign key (run_id, task_id) references unified_check_tasks(run_id, id),
  constraint unified_check_planner_entries_canonical_sequence_check
    check (canonical_sequence >= 0),
  constraint unified_check_planner_entries_result_bytes_check
    check (result_bytes is null or result_bytes >= 0),
  constraint unified_check_planner_entries_reserved_bytes_check
    check (reserved_bytes is null or reserved_bytes >= 0),
  constraint unified_check_planner_entries_state_check
    check (planner_state in ('planned', 'ready', 'committed')),
  constraint unified_check_planner_entries_state_shape_check
    check (
      (planner_state = 'planned'
        and result_bytes is null and ready_at is null and committed_at is null
        and ((admitted_at is null and reserved_bytes is null)
          or (admitted_at is not null and reserved_bytes is not null)))
      or (planner_state = 'ready'
        and admitted_at is not null and reserved_bytes is null
        and result_bytes is not null and ready_at is not null and committed_at is null)
      or (planner_state = 'committed'
        and admitted_at is not null and reserved_bytes is null
        and result_bytes is not null and ready_at is not null and committed_at is not null)
    ),
  constraint unified_check_planner_entries_timestamp_order_check
    check (
      (admitted_at is null or admitted_at >= planned_at)
      and (ready_at is null or ready_at >= admitted_at)
      and (committed_at is null or committed_at >= ready_at)
    )
);

create index unified_check_planner_entries_next_uncommitted_idx
  on unified_check_planner_entries(run_id, canonical_sequence)
  where planner_state <> 'committed';

create index unified_check_planner_entries_ready_prefix_idx
  on unified_check_planner_entries(run_id, canonical_sequence)
  where planner_state = 'ready';

create index unified_check_planner_entries_admitted_task_idx
  on unified_check_planner_entries(run_id, task_id)
  where planner_state = 'planned' and admitted_at is not null;

create index unified_check_planner_entries_buffer_aggregate_idx
  on unified_check_planner_entries(run_id, planner_state)
  include (result_bytes, reserved_bytes, ready_at, admitted_at);
