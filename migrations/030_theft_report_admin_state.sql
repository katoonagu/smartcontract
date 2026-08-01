alter table theft_reports
  add column if not exists admin_status text not null default 'new',
  add column if not exists admin_note text,
  add column if not exists admin_updated_at timestamptz;

alter table theft_reports drop constraint if exists theft_reports_admin_status_check;
alter table theft_reports
  add constraint theft_reports_admin_status_check
  check (admin_status in (
    'new',
    'awaiting_payment',
    'awaiting_documents',
    'in_progress',
    'escalated',
    'closed',
    'cancelled'
  ));

create index if not exists theft_reports_admin_status_updated_idx
  on theft_reports(admin_status, updated_at desc);
