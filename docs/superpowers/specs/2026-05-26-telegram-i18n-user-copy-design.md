# Telegram i18n + User Copy Design

Date: 2026-05-26

Status: approved design direction, not implemented.

## Summary

Telegram bot UI becomes bilingual: Russian by default, English as an explicit user choice. The goal is not only translation. The bot should explain checks, risks, limits, and next steps in language understandable to new and mid-level users.

Default behavior:

- New users see Russian.
- Existing users without a saved language see Russian.
- `/start` shows a language switch.
- Settings include language selection.
- Technical evidence remains stored as-is, but user-facing reports use clear text.

## Product Goals

1. Remove mixed RU/EN from normal bot screens.
2. Let every user choose Russian or English.
3. Make risk reports understandable without blockchain-forensics background.
4. Keep exact evidence, provider context, behavior signals, and weak inference separated.
5. Keep admin/debug surfaces usable, but do not optimize them before user-facing flows.

## Audience

Primary audience:

- Russian-speaking users who need a clear answer: what happened, why the score changed, what is exact evidence, and what requires review.
- Users with beginner to medium crypto experience.

Secondary audience:

- Operators/admins who need enough detail to review evidence and support users.
- English-speaking users who prefer the existing language.

## Language Model

Add a Telegram locale model:

```ts
type BotLocale = "ru" | "en";
```

Storage:

- Add `telegram_users.locale text not null default 'ru'`.
- Constraint: `locale in ('ru', 'en')`.
- Existing rows migrate to `ru`.

Repository API:

```ts
upsertTelegramUser(input: { telegramUserId: string; username: string | null; locale?: BotLocale }): Promise<void>
getTelegramUserLocale(telegramUserId: string): Promise<BotLocale>
updateTelegramUserLocale(telegramUserId: string, locale: BotLocale): Promise<void>
```

Runtime rules:

- `ensureTelegramUser` creates/updates user identity without overwriting existing locale.
- If locale is missing, use `ru`.
- Language callbacks update locale and redraw the current screen where practical.

## i18n Architecture

Create a small typed i18n layer for bot UI:

```ts
t(locale, key, params?)
```

Recommended files:

- `src/bot/i18n.ts`: locale type, dictionary, formatter helpers.
- `src/bot/messages.ts`: accept `locale` as first argument for user-facing messages.
- `src/bot/keyboards.ts`: accept `locale` for button text.
- `src/bot/createBot.ts`: resolve locale once per update and pass it into messages/keyboards.

Do not add a heavy library. The bot is small enough for typed dictionaries.

Dictionary shape:

```ts
const dict = {
  ru: {
    "button.wallets": "📁 Кошельки",
    "button.add": "➕ Добавить",
    "home.title": "🛡 TRON Guard"
  },
  en: {
    "button.wallets": "📁 Wallets",
    "button.add": "➕ Add",
    "home.title": "🛡 TRON Guard"
  }
} satisfies Record<BotLocale, Record<I18nKey, string>>;
```

Rules:

- Callback data stays English/stable: `settings:language:ru`, `settings:language:en`.
- Only visible text is translated.
- Internal codes stay unchanged.
- Tests should fail if a key is missing in either locale.

## Language Selection UX

First screen `/start`:

- Header in the current locale.
- Two buttons visible near top or first row:
  - `🇷🇺 Русский`
  - `🇬🇧 English`
- Then normal menu buttons.

Settings:

- Add section `Язык интерфейса` / `Interface language`.
- Show current language.
- Add buttons:
  - `🇷🇺 Русский`
  - `🇬🇧 English`

After switching:

Russian:

```text
Язык изменен на русский.
```

English:

```text
Language changed to English.
```

## Copy Style

Russian copy uses info-style principles:

- Put the conclusion first.
- Use short sentences.
- Explain technical words by consequence.
- Prefer verbs over abstract nouns.
- Avoid “мануальный ревью”, “provider context”, “boundary” without explanation.
- Do not write legal conclusions.

Allowed wording:

- `Это не доказательство нарушения. Это повод проверить цепочку.`
- `После биржи, моста или router нельзя считать публичную цепочку непрерывной.`
- `Контракт USDT показывает, что адрес в blacklist. Это состояние токен-контракта, а не поведенческая догадка.`

Forbidden wording:

- `fraud proven`
- `мошенничество доказано`
- `кошелек точно мошенник`
- `это адрес обменника`, unless the subject itself has a manual/internal entity label.

## Report Structure

All `/check address` reports use the same structure in both locales.

Russian fast report:

```text
🔎 Проверка адреса — предварительно

Адрес: T...
Риск: 🟠 80/100 (высокий, beta)

Что это значит
Адрес похож на транзитный: получил USDT и быстро вывел большую часть дальше.
Это не доказательство нарушения, но повод проверить цепочку.

Главные сигналы
• 98% исходящего объема ушло на один адрес.
• Цепочка дошла до router/service.
• За 30 дней переводов мало, поэтому добавлены последние исторические USDT-переводы.

Ограничения
После router/CEX/bridge нельзя считать публичную цепочку непрерывной.
Deep-анализ может добавить или изменить контекст.
```

English fast report:

```text
🔎 Address check — preliminary

Subject: T...
Risk: 🟠 80/100 (HIGH, beta)

What this means
The address looks transit-like: it received USDT and quickly moved most of it onward.
This is not proof of wrongdoing, but it is a reason to inspect the route.

Key signals
• 98% of outgoing volume went to one address.
• The route reached a router/service boundary.
• 30-day activity was sparse, so latest historical USDT transfers were added.

Limits
After a router/CEX/bridge, public-chain continuity should not be assumed.
Deep analysis may add or change context.
```

Deep report:

- Show final risk `/100`.
- Show previous fast risk.
- Say what changed.
- Put exact findings first:
  - USDT blacklist;
  - manual darknet seed provenance;
  - approval-drain provenance;
  - direct high-risk counterparty.
- Put behavior/context after exact findings.
- Put coverage and limits at the end.

## Scope

Phase 1 implementation should cover:

- Main menu buttons.
- Settings/profile/help/home.
- Add wallet/check address/check tx prompts.
- Wallet dashboard/analytics/safety/risk.
- `/check address` fast and deep reports.
- `/check_status`.
- Common error messages.

Admin-only flows may stay more technical in Phase 1 if needed, but they must not mix Russian and English on normal user screens.

Out of scope for Phase 1:

- Translating stored evidence JSON.
- Translating internal observation codes.
- Translating database labels.
- Auto-detecting locale from Telegram.
- Provider-specific translated legal text.

## Data Flow

1. Telegram update arrives.
2. `ensureTelegramUser` upserts identity.
3. Bot loads user locale, defaulting to `ru`.
4. Handler passes locale to messages and keyboards.
5. User taps language button.
6. Bot updates `telegram_users.locale`.
7. Bot redraws settings/home in the new locale.

Deep jobs:

- Store locale snapshot in `forensic_check_jobs.progress_json` when queued.
- Follow-up result uses the locale that was active when the job was queued.
- If no locale snapshot exists, use current user locale, then `ru`.

## Testing

Storage:

- Migration adds `telegram_users.locale` with default `ru`.
- Existing upsert does not overwrite saved locale.
- `updateTelegramUserLocale` persists `ru` and `en`.
- Invalid locale is rejected.

i18n:

- All keys exist in both dictionaries.
- `t("ru", key)` and `t("en", key)` return non-empty strings.
- Button keyboards render Russian and English labels.

Bot:

- `/start` defaults to Russian and shows language buttons.
- Language callback switches to English and redraws text/buttons.
- Settings shows current language and switch buttons.
- `/check address` fast report is Russian by default.
- Deep follow-up uses the queued locale snapshot.
- `/check tx` remains fast and does not queue deep jobs.
- Reports do not contain `fraud proven`, `Score: 45/50`, or mixed denominators.

Copy:

- Russian reports use clear sections: `Что это значит`, `Главные сигналы`, `Ограничения`.
- English reports keep equivalent sections: `What this means`, `Key signals`, `Limits`.
- Exact evidence is separated from behavior/context.

Regression:

- `npx vitest run tests/bot tests/storage tests/check`
- `npm run typecheck`
- `npm test`
- `git diff --check`

## Rollout

1. Add locale migration and repository methods.
2. Add typed i18n dictionary and localized keyboards.
3. Convert simple messages first: home/help/settings/profile/prompts.
4. Convert report formatter surfaces: fast `/check`, deep follow-up, `/check_status`.
5. Update tests and run full verification.

## Acceptance Criteria

- A new user sees Russian on `/start`.
- The first screen has a visible English switch.
- Settings can switch language both ways.
- Normal user-facing bot screens no longer mix RU/EN.
- `/check address` and deep follow-up are understandable to a non-expert.
- Technical evidence remains available in storage/admin paths.
- No legal attribution wording is introduced.
