create table if not exists customer_alert_recipients (
  owner_telegram_user_id text not null references telegram_users(telegram_user_id) on delete cascade,
  recipient_telegram_user_id text not null,
  alert_mode text not null default 'suspicious_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_telegram_user_id, recipient_telegram_user_id),
  check (owner_telegram_user_id <> recipient_telegram_user_id)
);

alter table customer_alert_recipients
  add column if not exists alert_mode text not null default 'suspicious_only',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table customer_alert_recipients drop constraint if exists customer_alert_recipients_alert_mode_check;
alter table customer_alert_recipients
  add constraint customer_alert_recipients_alert_mode_check
  check (alert_mode in ('all', 'suspicious_only'));

create index if not exists customer_alert_recipients_owner_idx
  on customer_alert_recipients(owner_telegram_user_id);

alter table telegram_user_sessions drop constraint if exists telegram_user_sessions_pending_action_check;
alter table telegram_user_sessions
  add constraint telegram_user_sessions_pending_action_check
  check (pending_action is null or pending_action in (
    'add_wallet',
    'check_address',
    'check_tx',
    'add_alert_admin',
    'add_alert_admin_all',
    'add_alert_admin_suspicious_only',
    'remove_alert_admin'
  ));
