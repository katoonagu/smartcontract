# Telegram Message Style Guide Status

Date: 2026-05-24

## Summary

Hermes suggested creating a standalone implementation plan for the Telegram message style guide. After the latest implementation work, that plan is mostly no longer a future phase: the core style-guide migration has already landed in code.

This note closes the documentation gap and records what is already implemented versus what remains as polish.

## Implemented

- Shared Telegram HTML helper layer in `src/alerts/telegramHtml.ts`:
  - `escapeHtml`
  - `bold`
  - `code`
  - `section`
  - `bulletList`
  - `formatRiskIcon`
  - `formatRiskLine`
  - `safeTruncateHtml`
  - `TelegramHtmlMessage`
  - `TelegramAlertMessage`
- Alert stream uses HTML parse mode:
  - incoming USDT user alerts;
  - customer-admin incoming alerts;
  - service-admin suspicious alerts;
  - digest alerts;
  - Approval Guard alerts;
  - Approval Guard pending-context alerts;
  - Approval Guard final context result alerts.
- Bot screens use HTML message objects:
  - `/start`;
  - `/help`;
  - wallet list;
  - wallet dashboard;
  - analytics;
  - Safety;
  - Risk intelligence;
  - Alert mode;
  - Profile;
  - Settings;
  - Alert admins;
  - add/check/remove prompts.
- Delivery paths preserve inline keyboards and pass `parse_mode: "HTML"` where relevant.
- Copy-sensitive values are wrapped in `<code>` where useful:
  - wallet addresses;
  - transaction hashes;
  - Telegram IDs;
  - scores and compact numeric values.
- Risk labels are visually normalized with risk icons:
  - LOW: green;
  - MEDIUM: yellow;
  - HIGH: orange;
  - CRITICAL: red.
- Product copy now follows the compact Telegram card pattern:
  - short titles;
  - key/value rows;
  - clear section blocks;
  - read-only safety language;
  - planned/not-connected modules separated from active modules.

## Verification Already Run

- `npm run typecheck`
- `npm test`

Latest verified result before this status note:

- 24 test files passed.
- 244 tests passed.

## Remaining Polish

These are small follow-up items, not a separate core implementation phase:

- Keep refining exact copy and emoji labels after live Telegram review.
- Add more visual smoke screenshots/manual notes if the bot UI changes again.
- Consider a README section that links to the style guide spec and this status note.
- Keep future bot screens on `TelegramHtmlMessage` instead of raw strings.

## Decision

Do not create a separate large "Telegram message style guide implementation" phase now. Treat the Hermes request as resolved by Phase 9.4 and Phase 9.5.1, with this status note as the documentation bridge.
