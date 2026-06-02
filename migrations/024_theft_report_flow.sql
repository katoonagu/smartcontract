alter table telegram_user_sessions
  add column if not exists selected_theft_report_id text;

alter table telegram_user_sessions drop constraint if exists telegram_user_sessions_pending_action_check;
alter table telegram_user_sessions
  add constraint telegram_user_sessions_pending_action_check
  check (pending_action is null or pending_action in (
    'add_wallet',
    'check_address',
    'check_tx',
    'report_theft_tx',
    'report_theft_comment',
    'add_alert_admin',
    'add_alert_admin_all',
    'add_alert_admin_suspicious_only',
    'remove_alert_admin'
  ));

create table if not exists theft_reports (
  id text primary key,
  telegram_user_id text not null references telegram_users(telegram_user_id) on delete cascade,
  tx_hash text not null,
  victim_address text not null,
  reported_scam_address text not null,
  amount_raw text not null,
  amount_usdt text not null,
  comment text,
  status text not null default 'draft',
  deposit_address text,
  deposit_amount_usdt text not null default '1000',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table theft_reports drop constraint if exists theft_reports_status_check;
alter table theft_reports
  add constraint theft_reports_status_check
  check (status in ('draft', 'awaiting_deposit', 'deposit_confirmed', 'documents_requested', 'cancelled'));

create index if not exists theft_reports_user_status_idx
  on theft_reports(telegram_user_id, status, created_at desc);

create index if not exists theft_reports_reported_scam_address_idx
  on theft_reports(reported_scam_address, created_at desc);
