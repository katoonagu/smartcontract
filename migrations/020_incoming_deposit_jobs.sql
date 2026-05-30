alter table forensic_check_jobs drop constraint if exists forensic_check_jobs_kind_check;

alter table forensic_check_jobs
  add constraint forensic_check_jobs_kind_check
  check (kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));

alter table observed_transactions drop constraint if exists observed_transactions_user_alert_status_check;

alter table observed_transactions
  add constraint observed_transactions_user_alert_status_check
  check (user_alert_status in ('pending', 'sending', 'analyzing', 'sent', 'failed', 'skipped'));

drop index if exists forensic_check_jobs_active_unique_idx;

create unique index if not exists forensic_check_jobs_active_unique_idx
  on forensic_check_jobs(
    kind,
    subject_address,
    window_start,
    window_end,
    coalesce(requested_by, ''),
    coalesce(progress_json->>'depositTxHash', '')
  )
  where status in ('queued', 'running');
