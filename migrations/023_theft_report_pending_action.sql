alter table telegram_user_sessions drop constraint if exists telegram_user_sessions_pending_action_check;
alter table telegram_user_sessions
  add constraint telegram_user_sessions_pending_action_check
  check (pending_action is null or pending_action in (
    'add_wallet',
    'check_address',
    'check_tx',
    'report_theft_tx',
    'add_alert_admin',
    'add_alert_admin_all',
    'add_alert_admin_suspicious_only',
    'remove_alert_admin'
  ));
