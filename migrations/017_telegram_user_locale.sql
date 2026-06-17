alter table telegram_users
  add column if not exists locale text not null default 'ru';

update telegram_users
set locale = 'ru'
where locale is null or locale not in ('ru', 'en');

alter table telegram_users drop constraint if exists telegram_users_locale_check;
alter table telegram_users
  add constraint telegram_users_locale_check
  check (locale in ('ru', 'en'));
