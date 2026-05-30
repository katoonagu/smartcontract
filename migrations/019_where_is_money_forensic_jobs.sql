alter table forensic_check_jobs drop constraint if exists forensic_check_jobs_kind_check;

alter table forensic_check_jobs
  add constraint forensic_check_jobs_kind_check
  check (kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));
