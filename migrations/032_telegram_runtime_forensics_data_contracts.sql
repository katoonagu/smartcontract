create table if not exists schema_migration_receipts (
  version integer primary key,
  filename text not null unique,
  checksum_sha256 text not null,
  applied_at timestamptz not null default now()
);

alter table schema_migration_receipts add column if not exists version integer;
alter table schema_migration_receipts add column if not exists filename text;
alter table schema_migration_receipts add column if not exists checksum_sha256 text;
alter table schema_migration_receipts add column if not exists applied_at timestamptz;
update schema_migration_receipts set applied_at = now() where applied_at is null;
alter table schema_migration_receipts alter column version set not null;
alter table schema_migration_receipts alter column filename set not null;
alter table schema_migration_receipts alter column checksum_sha256 set not null;
alter table schema_migration_receipts alter column applied_at set default now();
alter table schema_migration_receipts alter column applied_at set not null;

alter table schema_migration_receipts
  drop constraint if exists schema_migration_receipts_pkey;
alter table schema_migration_receipts
  add constraint schema_migration_receipts_pkey primary key (version);
alter table schema_migration_receipts
  drop constraint if exists schema_migration_receipts_filename_key;
alter table schema_migration_receipts
  add constraint schema_migration_receipts_filename_key unique (filename);

alter table schema_migration_receipts
  drop constraint if exists schema_migration_receipts_checksum_check;
alter table schema_migration_receipts
  add constraint schema_migration_receipts_checksum_check
  check (checksum_sha256 ~ '^[0-9a-f]{64}$');

alter table wallet_approvals add column if not exists allowance_confirmed_raw text;
alter table wallet_approvals add column if not exists allowance_check_status text;
alter table wallet_approvals add column if not exists allowance_checked_at timestamptz;
alter table wallet_approvals add column if not exists allowance_fresh_until timestamptz;
alter table wallet_approvals add column if not exists allowance_last_attempt_at timestamptz;
alter table wallet_approvals add column if not exists allowance_failure_code text;

update wallet_approvals
set allowance_confirmed_raw = null,
  allowance_check_status = 'stale',
  allowance_checked_at = null,
  allowance_fresh_until = null,
  allowance_last_attempt_at = null,
  allowance_failure_code = null,
  current_allowance_raw = '0',
  is_unlimited = false,
  status = 'unknown';

alter table wallet_approvals alter column allowance_check_status set default 'stale';
alter table wallet_approvals alter column allowance_check_status set not null;

alter table wallet_approvals drop constraint if exists wallet_approvals_allowance_status_v2_check;
alter table wallet_approvals
  add constraint wallet_approvals_allowance_status_v2_check
  check (allowance_check_status in ('confirmed_active', 'confirmed_zero', 'failed', 'stale'));

alter table wallet_approvals drop constraint if exists wallet_approvals_allowance_uint256_v2_check;
alter table wallet_approvals
  add constraint wallet_approvals_allowance_uint256_v2_check
  check (
    allowance_confirmed_raw is null
    or (
      allowance_confirmed_raw ~ '^(0|[1-9][0-9]*)$'
      and (
        length(allowance_confirmed_raw) < 78
        or (
          length(allowance_confirmed_raw) = 78
          and allowance_confirmed_raw <= '115792089237316195423570985008687907853269984665640564039457584007913129639935'
        )
      )
    )
  );

alter table wallet_approvals drop constraint if exists wallet_approvals_allowance_shape_v2_check;
alter table wallet_approvals
  add constraint wallet_approvals_allowance_shape_v2_check
  check (
    (
      allowance_check_status = 'confirmed_active'
      and allowance_confirmed_raw is not null
      and allowance_confirmed_raw <> '0'
      and current_allowance_raw = allowance_confirmed_raw
      and is_unlimited = (
        allowance_confirmed_raw = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
      )
      and status = 'active'
    )
    or (
      allowance_check_status = 'confirmed_zero'
      and allowance_confirmed_raw is not null
      and allowance_confirmed_raw = '0'
      and current_allowance_raw = '0'
      and is_unlimited = false
      and status = 'revoked'
    )
    or (
      allowance_check_status in ('failed', 'stale')
      and current_allowance_raw = '0'
      and is_unlimited = false
      and status = 'unknown'
    )
  );

alter table wallet_approvals drop constraint if exists wallet_approvals_allowance_failure_v2_check;
alter table wallet_approvals
  add constraint wallet_approvals_allowance_failure_v2_check
  check (
    (
      allowance_check_status = 'failed'
      and allowance_failure_code is not null
      and allowance_failure_code in (
        'provider_timeout',
        'provider_unavailable',
        'malformed_response',
        'contract_call_reverted',
        'network_mismatch',
        'subject_binding_failed',
        'unknown_provider_error'
      )
    )
    or (allowance_check_status <> 'failed' and allowance_failure_code is null)
  );

alter table wallet_approvals drop constraint if exists wallet_approvals_allowance_timestamps_v2_check;
alter table wallet_approvals
  add constraint wallet_approvals_allowance_timestamps_v2_check
  check (
    (
      allowance_check_status in ('confirmed_active', 'confirmed_zero')
      and allowance_checked_at is not null
      and allowance_last_attempt_at is not null
      and allowance_fresh_until is not null
      and allowance_last_attempt_at = allowance_checked_at
      and allowance_fresh_until = allowance_checked_at + interval '15 minutes'
    )
    or (
      allowance_check_status = 'failed'
      and allowance_last_attempt_at is not null
      and (
        (
          allowance_confirmed_raw is null
          and allowance_checked_at is null
          and allowance_fresh_until is null
        )
        or (
          allowance_confirmed_raw is not null
          and allowance_checked_at is not null
          and allowance_fresh_until is not null
          and allowance_last_attempt_at >= allowance_checked_at
          and allowance_fresh_until = allowance_checked_at + interval '15 minutes'
        )
      )
    )
    or (
      allowance_check_status = 'stale'
      and (
        (
          allowance_confirmed_raw is null
          and allowance_checked_at is null
          and allowance_fresh_until is null
          and allowance_last_attempt_at is null
        )
        or (
          allowance_confirmed_raw is not null
          and allowance_checked_at is not null
          and allowance_fresh_until is not null
          and allowance_last_attempt_at = allowance_checked_at
          and allowance_fresh_until = allowance_checked_at + interval '15 minutes'
        )
      )
    )
  );

drop index if exists idx_wallet_approvals_allowance_refresh;
create index idx_wallet_approvals_allowance_refresh
  on wallet_approvals(allowance_check_status, allowance_fresh_until);
