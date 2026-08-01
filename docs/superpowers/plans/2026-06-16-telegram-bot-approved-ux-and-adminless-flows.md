# Telegram Bot Approved UX And Adminless Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Telegram bot UX: an all-at-once main menu, a dedicated `Проверить USDT` button, functional `Approvals`, free address/tx input routing, user-only settings/help copy, and no Telegram admin button, command, callback, or pending-state entry point.

**Architecture:** Keep the change in the Telegram UX layer (`src/bot/*`) and repository session typing, reuse the existing check/forensic engines, and keep web-admin work out of the bot. Schema work is limited to pending-action constraint cleanup and the expanded theft-report wizard; the menu and `Проверить USDT` do not require DB data-model changes.

**Tech Stack:** TypeScript, grammY inline keyboards, Vitest, PostgreSQL SQL migrations, PowerShell/npm.

---

## Source Design

Use `docs/superpowers/specs/2026-06-16-telegram-bot-ux-menu-and-flows-design.md` as the product source.

Non-negotiables:

- Main menu exposes the working tools immediately.
- Admin stays in the web admin panel only.
- `Сообщить о краже` is a single centered row.
- `Проверить USDT` is a first-level button.
- `Approvals` remains the button label; message copy explains it as USDT permissions.
- Plain TRON address starts wallet check, not wallet monitoring.
- Plain tx hash starts tx check.
- Do not use absolute safety labels such as `Безопасно`, `Чисто`, or `100% риска нет` in result/status copy.

## Current Code Map

- `src/bot/keyboards.ts`
  - Owns callback parsing and all inline keyboard layouts.
  - Current main menu still has `Risk intel`, `Profile`, and no `Проверить USDT`.
  - Current settings and profile keyboards expose alert-admin callbacks.
  - Current theft next steps exposes `theft:admin:<id>`.

- `src/bot/i18n.ts`
  - Owns button labels.
  - Current labels include `button.riskIntel`, `button.profile`, and alert-admin labels used in Telegram UI.

- `src/bot/messages.ts`
  - Owns home/help/settings/profile/prompts/result copy.
  - Current settings/profile/my_id copy mentions alert admins.
  - Current help has "Risk intelligence" style language that should move behind "What the bot checks".

- `src/bot/createBot.ts`
  - Owns command handlers, callback handlers, free text routing, and background manual checks.
  - Current free TRON address input calls `addWalletAndShowDashboard`.
  - Current Telegram commands include customer alert-admin commands and service-admin commands.
  - Current callback handler includes `risk_overview`, `theft_admin`, and alert-admin settings flows.

- `src/storage/repositories.ts`
  - Owns `TelegramUserPendingAction`.
  - Current pending-action union and DB constraint include alert-admin pending actions.
  - Current `theft_reports` shape is tx-first and cannot store the approved wider theft wizard cleanly.

- `tests/bot/createBot.test.ts`
  - Current smoke tests assert the old main menu and alert-admin Telegram flows.

- `tests/bot/messages.test.ts`
  - Current message tests assert alert-admin settings copy.

## Implementation Tasks

- [ ] 1. Add failing smoke coverage for the approved menu and callback contract.

  Files:

  - `tests/bot/createBot.test.ts`
  - `src/bot/keyboards.ts`

  Update the existing `/start` smoke test to expect this button layout:

  ```ts
  expect(buttonRows(lastMessagePayload(calls))).toEqual([
    ["🔎 Check wallet", "🧾 Check tx"],
    ["Approvals", "📁 Wallets"],
    ["🚨 Report theft"],
    ["💵 Check USDT", "⚙️ Settings"],
    ["❔ Help"]
  ]);
  ```

  Add the Russian layout assertion to the locale test:

  ```ts
  expect(buttonRows(lastMessagePayload(calls))).toEqual([
    ["🔎 Проверить кошелек", "🧾 Проверить tx"],
    ["Approvals", "📁 Кошельки"],
    ["🚨 Сообщить о краже"],
    ["💵 Проверить USDT", "⚙️ Настройки"],
    ["❔ Помощь"]
  ]);
  ```

  Extend callback parsing tests:

  ```ts
  expect(parseCallbackData("check:usdt")).toEqual({ kind: "check_usdt" });
  expect(parseCallbackData("check:approvals")).toEqual({ kind: "approvals" });
  expect(parseCallbackData("settings:alerts")).toBeNull();
  expect(parseCallbackData("settings:add_admin:suspicious")).toBeNull();
  expect(parseCallbackData("settings:remove_admin")).toBeNull();
  expect(parseCallbackData("theft:admin:report-1")).toBeNull();
  expect(parseCallbackData("risk:intel")).toBeNull();
  ```

  Run:

  ```powershell
  npm test -- tests/bot/createBot.test.ts
  ```

  Expected result before implementation: this targeted test run fails on old labels/callbacks.

- [ ] 2. Update button labels and first-level keyboards.

  Files:

  - `src/bot/i18n.ts`
  - `src/bot/keyboards.ts`

  Add or update button keys:

  ```ts
  // ru
  "button.checkWallet": "🔎 Проверить кошелек",
  "button.tx": "🧾 Проверить tx",
  "button.approvals": "Approvals",
  "button.usdt": "💵 Проверить USDT",
  "button.wallets": "📁 Кошельки",
  "button.reportTheft": "🚨 Сообщить о краже",
  "button.settings": "⚙️ Настройки",
  "button.help": "❔ Помощь",

  // en
  "button.checkWallet": "🔎 Check wallet",
  "button.tx": "🧾 Check tx",
  "button.approvals": "Approvals",
  "button.usdt": "💵 Check USDT",
  "button.wallets": "📁 Wallets",
  "button.reportTheft": "🚨 Report theft",
  "button.settings": "⚙️ Settings",
  "button.help": "❔ Help",
  ```

  Replace `BotCallback` admin/risk menu variants with the user-facing variants:

  ```ts
  export type BotCallback =
    | { kind: "home" }
    | { kind: "help" }
    | { kind: "profile" }
    | { kind: "wallets_list" }
    | { kind: "wallet_add" }
    | { kind: "approvals" }
    | { kind: "check_address" }
    | { kind: "check_address_value"; address: string }
    | { kind: "check_cross_bridge"; address: string }
    | { kind: "check_deposit_job"; jobId: string }
    | { kind: "check_tx" }
    | { kind: "check_usdt" }
    | { kind: "theft_start" }
    | { kind: "theft_kind"; incidentKind: TheftIncidentKind }
    | { kind: "theft_confirm"; reportId: string }
    | { kind: "theft_change_tx"; reportId: string }
    | { kind: "theft_comment"; reportId: string }
    | { kind: "theft_cancel"; reportId: string }
    | { kind: "theft_deposit_sent"; reportId: string }
    | { kind: "theft_guide"; reportId: string }
    | { kind: "theft_approvals"; reportId: string }
    | { kind: "theft_tx"; reportId: string }
    | { kind: "settings" }
    | { kind: "settings_language"; locale: BotLocale }
    | { kind: "wallet_view"; walletId: string }
    | { kind: "wallet_refresh"; walletId: string }
    | { kind: "wallet_analytics"; walletId: string }
    | { kind: "wallet_risk"; walletId: string }
    | { kind: "wallet_safety"; walletId: string }
    | { kind: "wallet_alert_mode"; walletId: string }
    | { kind: "wallet_alert_mode_set"; walletId: string; alertMode: WalletAlertMode; digestIntervalMinutes: number }
    | { kind: "wallet_remove"; walletId: string }
    | { kind: "wallet_remove_confirm"; walletId: string }
    | { kind: "cancel" };
  ```

  Add parser branches:

  ```ts
  if (data === "check:approvals") return { kind: "approvals" };
  if (data === "check:usdt") return { kind: "check_usdt" };
  ```

  Replace the main menu:

  ```ts
  export function mainMenuKeyboard(locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
    return new InlineKeyboard()
      .text(t(locale, "button.checkWallet"), "check:addr")
      .text(t(locale, "button.tx"), "check:tx")
      .row()
      .text(t(locale, "button.approvals"), "check:approvals")
      .text(t(locale, "button.wallets"), "wl:list")
      .row()
      .text(t(locale, "button.reportTheft"), "theft:start")
      .row()
      .text(t(locale, "button.usdt"), "check:usdt")
      .text(t(locale, "button.settings"), "settings")
      .row()
      .text(t(locale, "button.help"), "help");
  }
  ```

  Update secondary keyboards:

  ```ts
  export function settingsKeyboard(locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
    return new InlineKeyboard()
      .text(t(locale, "button.language.ru"), "settings:language:ru")
      .text(t(locale, "button.language.en"), "settings:language:en")
      .row()
      .text(t(locale, "button.wallets"), "wl:list")
      .text(t(locale, "button.menu"), "home");
  }

  export function profileKeyboard(locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
    return new InlineKeyboard()
      .text(t(locale, "button.wallets"), "wl:list")
      .text(t(locale, "button.settings"), "settings")
      .row()
      .text(t(locale, "button.help"), "help")
      .text(t(locale, "button.menu"), "home");
  }

  export function theftReportNextStepsKeyboard(reportId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
    return new InlineKeyboard()
      .text(t(locale, "button.approvals"), `theft:approvals:${reportId}`)
      .text(t(locale, "button.tx"), `theft:tx:${reportId}`)
      .row()
      .text(t(locale, "button.guide"), `theft:guide:${reportId}`)
      .text(t(locale, "button.menu"), "home");
  }
  ```

  Add an approvals wallet picker:

  ```ts
  export function approvalsWalletPickerKeyboard(wallets: WatchedWallet[], locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    for (const wallet of wallets) {
      keyboard.text(shortAddress(wallet.address), `wl:safety:${wallet.id}`).row();
    }
    return keyboard
      .text(t(locale, "button.add"), "wl:add")
      .text(t(locale, "button.menu"), "home");
  }
  ```

- [ ] 3. Rewrite user-facing copy for home, help, settings, profile, prompts, and unsupported input.

  Files:

  - `src/bot/messages.ts`
  - `tests/bot/messages.test.ts`

  Replace `homeMessage` with concise control-panel copy:

  ```ts
  export function homeMessage(walletCount: number, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
    if (locale === "ru") {
      return msg([
        bold("TRON Guard"),
        "Проверяю TRON-адреса, транзакции и разрешения USDT.",
        "Можно отправить адрес или tx hash прямо сюда. Для частых действий используйте кнопки.",
        kv("Кошельков под наблюдением", code(String(walletCount))),
        "Бот только читает блокчейн. Он не хранит ключи и не подписывает транзакции."
      ]);
    }
    return msg([
      bold("TRON Guard"),
      "Checks TRON addresses, transactions, and USDT approvals.",
      "You can send an address or tx hash here, or use the buttons for frequent actions.",
      kv("Watched wallets", code(String(walletCount))),
      "The bot is read-only. It does not store keys or sign transactions."
    ]);
  }
  ```

  Add `checkUsdtPrompt`:

  ```ts
  export function checkUsdtPrompt(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
    if (locale === "ru") {
      return msg([
        bold("💵 Проверить USDT"),
        "Отправьте tx hash входящего USDT.",
        "Проверю сумму, отправителя, получателя, подтверждения и найденные признаки риска."
      ]);
    }
    return msg([
      bold("💵 Check USDT"),
      "Send the incoming USDT tx hash.",
      "I will check the amount, sender, receiver, confirmations, and risk signals found."
    ]);
  }
  ```

  Add approvals entry messages:

  ```ts
  export function approvalsNoWalletsMessage(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
    return locale === "ru"
      ? msg([bold("Approvals"), "Чтобы проверить разрешения USDT, добавьте кошелек в наблюдение или отправьте адрес на проверку."])
      : msg([bold("Approvals"), "Add a watched wallet to check USDT approvals, or send an address for a wallet check."]);
  }

  export function approvalsChooseWalletMessage(walletCount: number, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
    return locale === "ru"
      ? msg([bold("Approvals"), `Выберите кошелек. Доступно: ${code(String(walletCount))}.`, "Покажу активные разрешения USDT и рискованные spender."])
      : msg([bold("Approvals"), `Choose a wallet. Available: ${code(String(walletCount))}.`, "I will show active USDT approvals and risky spenders."]);
  }
  ```

  Add unsupported input message:

  ```ts
  export function unsupportedInputMessage(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
    return locale === "ru"
      ? msg([bold("Не понял сообщение."), "Отправьте TRON-адрес, tx hash или выберите действие в меню."])
      : msg([bold("I could not read that."), "Send a TRON address, tx hash, or choose an action in the menu."]);
  }
  ```

  Rewrite `settingsMessage` to remove the recipients parameter:

  ```ts
  export function settingsMessage(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
    if (locale === "ru") {
      return msg([
        bold("⚙️ Настройки"),
        [kv("Уведомления", "настраиваются в кошельках"), kv("Язык", languageName(locale))].join("\n"),
        "Бот только читает блокчейн. Он не хранит ключи и не подписывает транзакции."
      ]);
    }
    return msg([
      bold("⚙️ Settings"),
      [kv("Alerts", "configured per wallet"), kv("Language", languageName(locale))].join("\n"),
      "The bot is read-only. It does not store keys or sign transactions."
    ]);
  }
  ```

  Remove alert-admin wording from `myIdMessage` and `profileMessage`:

  ```ts
  "Share this ID only when support asks for it."
  "Этот ID нужен только если поддержка попросит его."
  ```

  Update `helpMessage` sections:

  - "How to read results"
  - "What the bot checks"
  - "How to revoke approvals"
  - "What to do after theft"

  Keep commands list user-only:

  ```ts
  `${bold("Commands")}: ${code("/add_wallet")}, ${code("/wallets")}, ${code("/check")}, ${code("/check_status")}, ${code("/settings")}, ${code("/my_id")}.`
  ```

- [ ] 4. Wire `Проверить USDT`, `Approvals`, and free-input routing in `createBot.ts`.

  File:

  - `src/bot/createBot.ts`

  Import the new messages and keyboard:

  ```ts
  import {
    approvalsChooseWalletMessage,
    approvalsNoWalletsMessage,
    checkUsdtPrompt,
    unsupportedInputMessage
  } from "./messages";
  import { approvalsWalletPickerKeyboard } from "./keyboards";
  ```

  Add helper for the top-level approvals button:

  ```ts
  async function showApprovalsEntry(
    ctx: Context,
    config: AppConfig,
    db: Db,
    tronClient: TronDashboardClient,
    telegramUserId: string,
    locale: BotLocale
  ): Promise<void> {
    const wallets = await listWatchedWallets(db, telegramUserId);
    if (wallets.length === 0) {
      await replyOrEdit(ctx, approvalsNoWalletsMessage(locale), new InlineKeyboard()
        .text(t(locale, "button.add"), "wl:add")
        .text(t(locale, "button.checkWallet"), "check:addr")
        .row()
        .text(t(locale, "button.menu"), "home"));
      return;
    }
    if (wallets.length === 1) {
      const dashboard = await buildWalletDashboard(config, db, tronClient, wallets[0]);
      await replyOrEdit(ctx, safetyMessage(dashboard, locale), walletSafetyKeyboard(wallets[0], locale));
      return;
    }
    await replyOrEdit(ctx, approvalsChooseWalletMessage(wallets.length, locale), approvalsWalletPickerKeyboard(wallets, locale));
  }
  ```

  Add callback branches:

  ```ts
  if (callback.kind === "approvals") {
    await clearTelegramUserPendingAction(db, id);
    await showApprovalsEntry(ctx, config, db, tronClient, id, locale);
    return;
  }

  if (callback.kind === "check_usdt") {
    await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "check_tx" });
    await replyOrEdit(ctx, checkUsdtPrompt(locale), cancelKeyboard(locale));
    return;
  }
  ```

  Change free text routing:

  ```ts
  const input = classifyInput(text);
  if (input.kind === "tron_address") {
    await startPendingCheckInBackground(input.value, "address", ctx, tronClient, db, getAddressRiskSignalsForAddress, {
      telegramUserId: id,
      checkSmartContractAddress,
      queueWhereIsMoneyJob,
      queueDeepForensicJob,
      runtimeLabel: config.runtimeInstanceLabel,
      locale
    });
    return;
  }

  if (input.kind === "tron_tx") {
    await startPendingCheckInBackground(input.value, "tx", ctx, tronClient, db, getAddressRiskSignalsForAddress, {
      telegramUserId: id,
      checkSmartContractAddress,
      queueWhereIsMoneyJob,
      queueDeepForensicJob,
      runtimeLabel: config.runtimeInstanceLabel,
      locale
    });
    return;
  }

  await sendMessage(ctx, unsupportedInputMessage(locale), mainMenuKeyboard(locale));
  ```

  Add or update tests:

  ```ts
  await bot.handleUpdate(callbackQueryUpdate("check:usdt", userId));
  expect(lastPlainText(calls)).toContain("Check USDT");

  await bot.handleUpdate(callbackQueryUpdate("check:approvals", userId));
  expect(lastPlainText(calls)).toContain("Approvals");

  await bot.handleUpdate(messageUpdate(walletAddress, userId));
  expect(lastPlainText(calls)).toContain("Address check started");
  expect(lastPlainText(calls)).not.toContain("Wallet added");

  await bot.handleUpdate(messageUpdate("hello", userId));
  expect(lastPlainText(calls)).toContain("Send a TRON address");
  ```

- [ ] 5. Remove all Telegram admin entry points.

  Files:

  - `src/bot/createBot.ts`
  - `src/bot/keyboards.ts`
  - `src/bot/messages.ts`
  - `src/bot/i18n.ts`
  - `src/storage/repositories.ts`
  - `migrations/025_telegram_adminless_pending_actions.sql`
  - `tests/bot/createBot.test.ts`
  - `tests/bot/messages.test.ts`
  - `tests/storage/repositories.test.ts`

  Remove Telegram command registrations:

  ```ts
  bot.command("alert_admins", ...);
  bot.command("alert_recipients", ...);
  bot.command("add_alert_admin", ...);
  bot.command("alert_add", ...);
  bot.command("remove_alert_admin", ...);
  bot.command("alert_remove", ...);
  bot.command("alert_mode", ...);
  bot.command("labels", ...);
  bot.command("admin_users", ...);
  bot.command("mark", ...);
  bot.command("recheck_safety", ...);
  ```

  Remove callback handling for:

  ```ts
  settings_alerts
  settings_add_admin
  settings_remove_admin
  settings_remove_admin_value
  theft_admin
  risk_overview
  ```

  Remove pending text handling for:

  ```ts
  add_alert_admin
  add_alert_admin_all
  add_alert_admin_suspicious_only
  remove_alert_admin
  ```

  Update session pending action typing:

  ```ts
  export type TelegramUserPendingAction =
    | "add_wallet"
    | "check_address"
    | "check_tx"
    | "report_theft_tx"
    | "report_theft_comment";
  ```

  Add migration `migrations/025_telegram_adminless_pending_actions.sql`:

  ```sql
  update telegram_user_sessions
  set pending_action = null,
      selected_wallet_id = null,
      selected_theft_report_id = null,
      updated_at = now()
  where pending_action in (
    'add_alert_admin',
    'add_alert_admin_all',
    'add_alert_admin_suspicious_only',
    'remove_alert_admin'
  );

  alter table telegram_user_sessions drop constraint if exists telegram_user_sessions_pending_action_check;
  alter table telegram_user_sessions
    add constraint telegram_user_sessions_pending_action_check
    check (pending_action is null or pending_action in (
      'add_wallet',
      'check_address',
      'check_tx',
      'report_theft_tx',
      'report_theft_comment'
    ));
  ```

  Replace old admin tests with negative coverage:

  ```ts
  await bot.handleUpdate(messageUpdate("/admin_users", adminId));
  expect(lastPlainText(calls)).not.toContain("service admins");
  expect(lastPlainText(calls)).toContain("Send a TRON address");

  await bot.handleUpdate(messageUpdate("/alert_recipients", userId));
  expect(lastPlainText(calls)).not.toContain("Alert admin");
  expect(lastPlainText(calls)).toContain("Send a TRON address");
  ```

  Keep non-admin user commands:

  ```text
  /start
  /help
  /settings
  /language
  /profile
  /my_id
  /wallet_mode
  /add_wallet
  /wallets
  /remove_wallet
  /check
  /version
  /check_status
  ```

  Reasoning: `/profile` and `/my_id` are user identity screens, not admin entry points, after their admin copy is removed.

- [ ] 6. Implement the approved theft-report wizard without Telegram admin contact.

  Files:

  - `migrations/026_theft_report_incident_wizard.sql`
  - `src/storage/repositories.ts`
  - `src/bot/keyboards.ts`
  - `src/bot/messages.ts`
  - `src/bot/createBot.ts`
  - `tests/storage/repositories.test.ts`
  - `tests/bot/createBot.test.ts`

  Add theft incident types:

  ```ts
  export type TheftIncidentKind = "stolen_assets" | "suspicious_tx" | "signed_approval" | "unsure";
  export type TheftLostAsset = "USDT" | "TRX" | "other" | "unknown";
  ```

  Add migration:

  ```sql
  alter table theft_reports
    add column if not exists incident_kind text not null default 'unsure',
    add column if not exists lost_asset text not null default 'unknown',
    add column if not exists noticed_at_text text,
    alter column tx_hash drop not null,
    alter column victim_address drop not null,
    alter column reported_scam_address drop not null,
    alter column amount_raw drop not null,
    alter column amount_usdt drop not null;

  alter table theft_reports drop constraint if exists theft_reports_incident_kind_check;
  alter table theft_reports
    add constraint theft_reports_incident_kind_check
    check (incident_kind in ('stolen_assets', 'suspicious_tx', 'signed_approval', 'unsure'));

  alter table theft_reports drop constraint if exists theft_reports_lost_asset_check;
  alter table theft_reports
    add constraint theft_reports_lost_asset_check
    check (lost_asset in ('USDT', 'TRX', 'other', 'unknown'));
  ```

  Update `TheftReport` nullable fields:

  ```ts
  export type TheftReport = {
    id: string;
    telegramUserId: string;
    incidentKind: TheftIncidentKind;
    txHash: string | null;
    victimAddress: string | null;
    reportedScamAddress: string | null;
    amountRaw: string | null;
    amountUsdt: string | null;
    lostAsset: TheftLostAsset;
    noticedAtText: string | null;
    comment: string | null;
    status: TheftReportStatus;
    depositAddress: string | null;
    depositAmountUsdt: string;
    createdAt: Date;
    updatedAt: Date;
  };
  ```

  Add repository functions:

  ```ts
  export async function createTheftReportDraft(db: Db, input: { telegramUserId: string; incidentKind: TheftIncidentKind }): Promise<TheftReport>;
  export async function updateTheftReportWallet(db: Db, input: { id: string; telegramUserId: string; victimAddress: string }): Promise<TheftReport | null>;
  export async function updateTheftReportTx(db: Db, input: { id: string; telegramUserId: string; txHash: string | null }): Promise<TheftReport | null>;
  export async function updateTheftReportLostAsset(db: Db, input: { id: string; telegramUserId: string; lostAsset: TheftLostAsset }): Promise<TheftReport | null>;
  export async function updateTheftReportNoticedAt(db: Db, input: { id: string; telegramUserId: string; noticedAtText: string }): Promise<TheftReport | null>;
  ```

  Keep `upsertTheftReportDraft` for tx-first compatibility, but have it populate the new fields:

  ```ts
  incident_kind = 'suspicious_tx'
  lost_asset = 'USDT'
  ```

  Add first-screen keyboard:

  ```ts
  export function theftIncidentKindKeyboard(locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
    return new InlineKeyboard()
      .text(locale === "en" ? "USDT / assets stolen" : "Украли USDT / активы", "theft:kind:stolen_assets")
      .row()
      .text(locale === "en" ? "Suspicious transaction" : "Подозрительная транзакция", "theft:kind:suspicious_tx")
      .row()
      .text(locale === "en" ? "Signed approval" : "Подписал разрешение", "theft:kind:signed_approval")
      .row()
      .text(locale === "en" ? "Not sure" : "Не уверен", "theft:kind:unsure")
      .row()
      .text(t(locale, "button.menu"), "home");
  }
  ```

  Add wizard messages:

  ```ts
  theftIncidentKindMessage(locale)
  theftWalletPrompt(locale)
  theftOptionalTxPrompt(locale)
  theftLostAssetKeyboard(locale)
  theftNoticedAtPrompt(locale)
  theftReportSummaryMessage(report, locale)
  ```

  Callback and pending-action flow:

  ```text
  theft:start -> theftIncidentKindMessage + theftIncidentKindKeyboard
  theft:kind:<kind> -> create draft, pending report_theft_wallet
  report_theft_wallet -> validate TRON address, save, pending report_theft_tx
  report_theft_tx -> accept tx hash or "нет", save, pending report_theft_asset
  report_theft_asset -> save via keyboard, pending report_theft_noticed_at
  report_theft_noticed_at -> save text, show summary
  ```

  Add parser and callback variants for summary buttons:

  ```ts
  const theftActionMatch = /^theft:(approvals|tx):([^:]+)$/.exec(data);
  if (theftActionMatch) {
    return theftActionMatch[1] === "approvals"
      ? { kind: "theft_approvals", reportId: theftActionMatch[2] }
      : { kind: "theft_tx", reportId: theftActionMatch[2] };
  }
  ```

  Extend `TelegramUserPendingAction` and the pending-action constraint in `026_theft_report_incident_wizard.sql`:

  ```ts
  export type TelegramUserPendingAction =
    | "add_wallet"
    | "check_address"
    | "check_tx"
    | "report_theft_kind"
    | "report_theft_wallet"
    | "report_theft_tx"
    | "report_theft_asset"
    | "report_theft_noticed_at"
    | "report_theft_comment";
  ```

  Summary buttons:

  ```text
  Approvals -> if report.victimAddress is a watched wallet, open wl:safety; otherwise show Tronscan approvals URL and wallet-check button.
  Проверить tx -> if tx exists, run existing tx check; otherwise show check tx prompt.
  Инструкция -> theft guide
  Назад в меню -> home
  ```

  No theft message may include `contact admin`, `админ`, `recovery guaranteed`, or `вернем средства`.

- [ ] 7. Clean stale imports, old helper functions, and copy.

  Files:

  - `src/bot/createBot.ts`
  - `src/bot/keyboards.ts`
  - `src/bot/messages.ts`
  - `src/bot/i18n.ts`

  Remove unused Telegram alert-admin helpers after command/callback deletion:

  ```ts
  parseAlertAdminInput
  parseAlertAdminRemoveInput
  showAlertAdmins
  addAlertAdminAndShow
  removeAlertAdminAndShow
  alertAdminsKeyboard
  alertAdminsMessage
  addAlertAdminPrompt
  removeAlertAdminPrompt
  alertAdminSavedMessage
  alertAdminRemovedMessage
  alertAdminNotFoundMessage
  ```

  Keep repository functions for customer alert recipients if the web admin, workers, or alerts still use them. This plan removes Telegram entry points, not storage capability.

  Search must return no Telegram admin UI/callback/command surfaces:

  ```powershell
  rg -n "alert_admin|alert admins|Alert admins|settings:alerts|settings:add_admin|settings:remove_admin|theft:admin|contactAdmin|Contact admin|админ" src/bot tests/bot
  ```

  Acceptable remaining matches:

  - test assertions that verify removed callbacks return `null`
  - web-admin files outside `src/bot`

- [ ] 8. Verification.

  Run targeted tests first:

  ```powershell
  npm test -- tests/bot/messages.test.ts tests/bot/createBot.test.ts tests/storage/repositories.test.ts
  ```

  Run full tests and typecheck:

  ```powershell
  npm test
  npm run typecheck
  ```

  Run migration verification on a clean or repaired local database:

  ```powershell
  npm run db:migrate
  ```

  Local caveat: the current database in this workspace previously failed before new migrations because an older `observed_transactions_user_alert_status_check` migration conflicts with existing `skipped`/`analyzing` rows. If that remains true, validate SQL migration syntax through tests and run `npm run db:migrate` against a clean dev database, or repair the existing local data before claiming DB migration success.

  Manual bot smoke test:

  ```powershell
  $env:ADMIN_DASHBOARD_ENABLED='true'
  $env:ADMIN_DASHBOARD_HOST='127.0.0.1'
  $env:ADMIN_DASHBOARD_PORT='8787'
  $env:ADMIN_DASHBOARD_TOKEN='local-admin-token'
  npm run dev
  ```

  In Telegram/local bot test harness:

  - `/start` shows the approved menu.
  - `Сообщить о краже` is a single centered row.
  - `Проверить USDT` prompts for incoming USDT tx hash.
  - `Approvals` opens the saved-wallet approvals path.
  - Pasting a TRON address starts a wallet check and does not add a watched wallet.
  - Pasting a tx hash starts a transaction check.
  - `/admin_users`, `/labels`, `/mark`, `/recheck_safety`, `/alert_recipients`, `/alert_add`, `/alert_remove`, `/alert_mode` do not expose admin screens or restricted-admin responses.
  - Settings contains only user settings.
  - Help contains "What the bot checks" instead of "Risk modules".

## Completion Criteria

- `npm test` passes.
- `npm run typecheck` passes.
- Migration verification is either successful on this database or explicitly verified on a clean dev database with the local old-migration caveat recorded.
- `rg` checks show no Telegram admin entry point in `src/bot`.
- Main menu matches the approved layout in both Russian and English tests.
- `Проверить USDT` and `Approvals` are functional callbacks, not dead buttons.
- Theft flow has no admin contact path and no recovery guarantee language.
