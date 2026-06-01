create index if not exists forensic_check_jobs_admin_created_idx
  on forensic_check_jobs(created_at desc);

create index if not exists forensic_check_jobs_admin_status_created_idx
  on forensic_check_jobs(status, created_at desc);

create index if not exists forensic_check_jobs_admin_kind_created_idx
  on forensic_check_jobs(kind, created_at desc);
