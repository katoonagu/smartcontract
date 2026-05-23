# Phase 6 FeeSaver-Style Telegram UX Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Telegram bot feel like a polished TRON security product using FeeSaver as a UX reference: compact bilingual copy, dense inline-button navigation, clearer profile/settings screens, and more useful first-screen wallet/risk actions.

**Architecture:** Keep the current monitoring/risk/repository foundation unchanged. This phase is presentation and navigation only: message formatters, inline keyboards, bot command/callback routing, tests, and README checklist. Do not add AML, graph forensics, approval scanning, or wallet-control features.

**Tech Stack:** TypeScript, grammY inline keyboards, Vitest, existing repository/config/monitor code.

---

## Product Direction

Reference behavior from FeeSaver:

- compact status message with emoji markers;
- bilingual Russian/English copy in the same screen;
- 2-column inline keyboard grid;
- clear profile/settings screens;
- short action labels;
- visual hierarchy through spacing and repeated symbols, not long paragraphs.

Do not copy FeeSaver branding, logo, wording, product claims, or color assets. Use only the Telegram UX pattern as reference.

Target tone:

- mostly English technical labels;
- Russian explanatory text where it helps comprehension;
- no walls of text;
- every screen should have an obvious next action.

---

## File Structure

Modify:

- `src/bot/messages.ts`
  - Add compact bilingual message format for home, help, profile, settings, wallet dashboard, risk intel, alert admins.
  - Keep existing exported functions to avoid large routing changes.

- `src/bot/keyboards.ts`
  - Add denser 2-column main menu.
  - Add `profile` callback.
  - Add profile/settings/admin/risk keyboards with consistent `Back` and `Menu`.

- `src/bot/createBot.ts`
  - Add `/profile` command.
  - Add `profile` callback routing.
  - Keep all current command aliases working.

- `tests/bot/createBot.test.ts`
  - Update copy assertions.
  - Add profile callback/command tests.
  - Add keyboard layout assertions.

- `README.md`
  - Document Phase 6 UX behavior and manual checklist.

Optional create:

- `src/bot/ui.ts`
  - Only create this if message helpers become noisy.
  - Suggested responsibility: reusable emoji labels and compact row helpers.

Do not modify:

- `src/monitor/monitorWorker.ts`
- `src/storage/repositories.ts`
- migrations
- risk engine logic

---

## Task 1: Main Menu UX Refresh

**Files:**

- Modify: `src/bot/messages.ts`
- Modify: `src/bot/keyboards.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write failing tests for the new `/start` screen**

Add or update tests in `tests/bot/createBot.test.ts`:

```ts
it("handles /start with compact bilingual product menu", async () => {
  const { bot, calls } = await createSmokeBot();

  await bot.handleUpdate(messageUpdate("/start", userId));

  expect(lastText(calls)).toContain("TRON Guard");
  expect(lastText(calls)).toContain("Мониторинг TRON / USDT");
  expect(lastText(calls)).toContain("Watched wallets:");
  expect(lastText(calls)).toContain("Risk checks: limited beta");
  expect(buttonTexts(lastMessagePayload(calls))).toEqual([
    "📁 My wallets",
    "➕ Add wallet",
    "🔍 Check address",
    "🧾 Check tx",
    "⚠️ Risk intel",
    "👤 Profile",
    "⚙️ Settings",
    "🆘 Help"
  ]);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "compact bilingual product menu"
```

Expected: FAIL because `TRON Guard`, new button labels, and profile button do not exist yet.

- [ ] **Step 3: Update `homeMessage`**

In `src/bot/messages.ts`, change `homeMessage(walletCount)` to this format:

```ts
export function homeMessage(walletCount: number): string {
  return [
    "🛡 TRON Guard",
    "",
    "Мониторинг TRON / USDT",
    `📁 Watched wallets: ${walletCount}`,
    "⚠️ Risk checks: limited beta",
    "🔔 Alerts: incoming USDT + risk reasons",
    "",
    "Выберите действие ниже."
  ].join("\n");
}
```

- [ ] **Step 4: Update main menu keyboard**

In `src/bot/keyboards.ts`, update `BotCallback`, `parseCallbackData`, and `mainMenuKeyboard`.

Add callback type:

```ts
| { kind: "profile" }
```

Add parser:

```ts
if (data === "profile") return { kind: "profile" };
if (data === "risk:intel") return { kind: "settings_alerts" };
```

Use this keyboard:

```ts
export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📁 My wallets", "wl:list")
    .text("➕ Add wallet", "wl:add")
    .row()
    .text("🔍 Check address", "check:addr")
    .text("🧾 Check tx", "check:tx")
    .row()
    .text("⚠️ Risk intel", "risk:intel")
    .text("👤 Profile", "profile")
    .row()
    .text("⚙️ Settings", "settings")
    .text("🆘 Help", "help");
}
```

Note: `risk:intel` can open the existing alert/risk settings shell for now, or a dedicated screen in Task 3. It must not claim forensic modules are live.

- [ ] **Step 5: Run the test**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "compact bilingual product menu"
```

Expected: PASS.

---

## Task 2: Profile Screen

**Files:**

- Modify: `src/bot/messages.ts`
- Modify: `src/bot/keyboards.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write failing profile tests**

Add tests:

```ts
it("opens profile from command and inline menu", async () => {
  const { bot, calls } = await createSmokeBot();

  await bot.handleUpdate(messageUpdate("/profile", userId));
  expect(lastText(calls)).toContain("👤 Profile");
  expect(lastText(calls)).toContain(`Telegram ID: ${userId}`);
  expect(lastText(calls)).toContain("Language: RU / EN");
  expect(buttonTexts(lastMessagePayload(calls))).toContain("📁 My wallets");
  expect(buttonTexts(lastMessagePayload(calls))).toContain("⚙️ Settings");

  await bot.handleUpdate(callbackQueryUpdate("profile", userId));
  expect(lastText(calls)).toContain("👤 Profile");
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "profile"
```

Expected: FAIL because `/profile`, `profileMessage`, and `profileKeyboard` do not exist.

- [ ] **Step 3: Add profile message**

In `src/bot/messages.ts`:

```ts
export function profileMessage(input: { telegramUserId: string; username: string | null; walletCount: number }): string {
  return [
    "👤 Profile",
    "",
    `User: ${input.username ? `@${input.username}` : "no username"}`,
    `Telegram ID: ${input.telegramUserId}`,
    `📁 Watched wallets: ${input.walletCount}`,
    "🇷🇺🇺🇸 Language: RU / EN",
    "",
    "Для подключения alert admin используйте /my_id."
  ].join("\n");
}
```

- [ ] **Step 4: Add profile keyboard**

In `src/bot/keyboards.ts`:

```ts
export function profileKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📁 My wallets", "wl:list")
    .text("⚙️ Settings", "settings")
    .row()
    .text("🔔 Alert admins", "settings:alerts")
    .text("🆘 Help", "help")
    .row()
    .text("⬅️ Menu", "home");
}
```

- [ ] **Step 5: Route `/profile` and callback**

In `src/bot/createBot.ts`, import `profileMessage` and `profileKeyboard`.

Add helper:

```ts
async function showProfile(ctx: Context, db: Db, telegramUserId: string): Promise<void> {
  const wallets = await listWatchedWallets(db, telegramUserId);
  await replyOrEdit(
    ctx,
    profileMessage({
      telegramUserId,
      username: ctx.from?.username ?? null,
      walletCount: wallets.length
    }),
    profileKeyboard()
  );
}
```

Add command:

```ts
bot.command("profile", async (ctx) => {
  const id = await ensureTelegramUser(ctx, db);
  await clearTelegramUserPendingAction(db, id);
  await showProfile(ctx, db, id);
});
```

Add callback branch before wallet-specific callback handling:

```ts
if (callback.kind === "profile") {
  await clearTelegramUserPendingAction(db, id);
  await showProfile(ctx, db, id);
  return;
}
```

- [ ] **Step 6: Run profile tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "profile"
```

Expected: PASS.

---

## Task 3: Wallet Dashboard Compact Copy

**Files:**

- Modify: `src/bot/messages.ts`
- Modify: `src/bot/keyboards.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write failing dashboard copy test**

Update the existing dashboard test to assert compact bilingual rows:

```ts
expect(texts[0]).toContain("📍 Wallet:");
expect(texts[0]).toContain("🟢 Monitoring: active");
expect(texts[0]).toContain("⚠️ Risk:");
expect(texts[0]).toContain("💵 USDT:");
expect(texts[0]).toContain("⛽ Gas/fees 30d:");
expect(buttonTexts(lastMessagePayload(calls))).toContain("🔄 Refresh");
expect(buttonTexts(lastMessagePayload(calls))).toContain("📊 Analytics");
expect(buttonTexts(lastMessagePayload(calls))).toContain("⚠️ Risk intel");
```

- [ ] **Step 2: Run the failing dashboard test**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "adds a valid wallet"
```

Expected: FAIL until dashboard copy and keyboard labels are updated.

- [ ] **Step 3: Update dashboard message**

In `src/bot/messages.ts`, change the start of `dashboardMessage` lines to:

```ts
const lines = [
  `📍 Wallet: ${shortAddress(dashboard.wallet.address)}`,
  "🟢 Monitoring: active",
  `🕒 Last check: ${formatRelativeTime(dashboard.pollState?.lastSuccessfulPollAt ?? null, now)}`,
  `📡 Last result: ${formatLastResult(dashboard)}`,
  "",
  `⚠️ Risk: ${dashboard.safety.score}/100 (${dashboard.safety.level}, beta)`,
  `💵 USDT: ${formatDecimal(formatMicroUsdt(dashboard.snapshot.usdtBalanceMicro), 2, 2)}`,
  `🔋 TRX: ${formatDecimal(formatSunAsTrx(dashboard.snapshot.trxBalanceSun), 2, 2)}`,
  "",
  `📅 Wallet age: ${formatWalletAge(dashboard.snapshot.walletCreatedAt, now)}`,
  "📊 30d flow:",
  `• In: ${formatDecimal(dashboard.snapshot.thirtyDayInUsdt, 2, 2)} USDT`,
  `• Out: ${formatDecimal(dashboard.snapshot.thirtyDayOutUsdt, 2, 2)} USDT`,
  `⛽ Gas/fees 30d: ${feeText}`
];
```

- [ ] **Step 4: Update wallet dashboard keyboard labels**

In `src/bot/keyboards.ts`:

```ts
export function walletDashboardKeyboard(walletId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔄 Refresh", `wl:refresh:${walletId}`)
    .text("📊 Analytics", `wl:analytics:${walletId}`)
    .row()
    .text("⚠️ Risk intel", `wl:risk:${walletId}`)
    .text("📁 Wallets", "wl:list")
    .row()
    .text("🔍 Check address", "check:addr")
    .text("🧾 Check tx", "check:tx")
    .row()
    .text("⚙️ Settings", "settings")
    .text("🗑 Remove", `wl:remove:${walletId}`);
}
```

- [ ] **Step 5: Run dashboard tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "adds a valid wallet"
```

Expected: PASS.

---

## Task 4: Settings and Alert Admins Polish

**Files:**

- Modify: `src/bot/messages.ts`
- Modify: `src/bot/keyboards.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write failing settings tests**

Update settings/admin tests:

```ts
expect(lastText(calls)).toContain("⚙️ Settings");
expect(lastText(calls)).toContain("🔔 Owner alerts: all incoming");
expect(lastText(calls)).toContain("👥 Alert admins:");
expect(buttonTexts(lastMessagePayload(calls))).toContain("👥 Alert admins");
expect(buttonTexts(lastMessagePayload(calls))).toContain("➕ Suspicious admin");
expect(buttonTexts(lastMessagePayload(calls))).toContain("➕ All-alerts admin");
```

- [ ] **Step 2: Run failing settings tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "settings"
```

Expected: FAIL until copy/buttons are updated.

- [ ] **Step 3: Update settings message**

In `src/bot/messages.ts`:

```ts
export function settingsMessage(recipients: CustomerAlertRecipient[] = []): string {
  return [
    "⚙️ Settings",
    "",
    "🔔 Owner alerts: all incoming",
    "🛡 Service admins: HIGH / CRITICAL",
    `👥 Alert admins: ${recipients.length}`,
    "🌐 Language: RU / EN mixed",
    "",
    "Бот read-only: не просит seed/private key и не подписывает транзакции."
  ].join("\n");
}
```

- [ ] **Step 4: Update settings keyboard labels**

In `src/bot/keyboards.ts`:

```ts
export function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("👥 Alert admins", "settings:alerts")
    .row()
    .text("➕ Suspicious admin", "settings:add_admin:suspicious")
    .row()
    .text("➕ All-alerts admin", "settings:add_admin:all")
    .text("➖ Remove admin", "settings:remove_admin")
    .row()
    .text("⬅️ Menu", "home");
}
```

- [ ] **Step 5: Update alert admin message**

In `src/bot/messages.ts`, adjust empty state:

```ts
"👥 Alert admins",
"",
"No customer alert admins configured.",
"",
"Owner получает все входящие. Extra admins получают best-effort alerts."
```

- [ ] **Step 6: Run settings/admin tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "settings|alert admins"
```

Expected: PASS.

---

## Task 5: Help and Risk Intel Product Copy

**Files:**

- Modify: `src/bot/messages.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write failing help/risk tests**

Add assertions:

```ts
expect(lastText(calls)).toContain("🛡 TRON Guard");
expect(lastText(calls)).toContain("Что умеет бот:");
expect(lastText(calls)).toContain("Risk score is limited beta");
expect(lastText(calls)).toContain("No wallet control. No private keys.");
```

For risk screen:

```ts
expect(lastText(calls)).toContain("⚠️ Risk intelligence");
expect(lastText(calls)).toContain("AML providers: not connected");
expect(lastText(calls)).toContain("Hop1/Hop2 graph: planned");
expect(lastText(calls)).toContain("Approvals/security: planned");
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "help|risk intelligence"
```

Expected: FAIL until copy is updated.

- [ ] **Step 3: Update `helpMessage`**

In `src/bot/messages.ts`:

```ts
export function helpMessage(): string {
  return [
    "🛡 TRON Guard",
    "",
    "Что умеет бот:",
    "• мониторит TRON wallets",
    "• присылает incoming USDT alerts",
    "• показывает wallet analytics",
    "• считает limited beta risk score",
    "",
    "Risk score is limited beta: AML, graph, approvals, bridge tracing, and case forensics are planned modules.",
    "",
    "No wallet control. No private keys.",
    "",
    "Commands: /add_wallet, /wallets, /check, /settings, /profile, /my_id."
  ].join("\n");
}
```

- [ ] **Step 4: Update `securityMessage` title**

In `src/bot/messages.ts`:

```ts
`⚠️ Risk intelligence: ${shortAddress(dashboard.wallet.address)}`
```

Keep existing module status list. Do not make planned modules look active.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "help|risk intelligence"
```

Expected: PASS.

---

## Task 6: README and Live Checklist

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update Telegram UX section**

Add this subsection:

```md
## Phase 6 Telegram UX

The bot uses a compact bilingual Telegram UI inspired by high-density utility bots:

- emoji-led status rows;
- RU/EN mixed copy;
- two-column inline menus;
- separate Profile, Settings, Wallets, Analytics, Risk intel, and Alert admins screens;
- read-only safety copy on user-facing screens.

This is only a UX refresh. It does not add AML providers, graph forensics, approvals indexing, or wallet-control features.
```

- [ ] **Step 2: Add manual checklist**

Append:

```md
## Phase 6 Manual Live Checklist

1. Restart the bot with `npm run dev`.
2. Send `/start`.
3. Confirm the first screen says `TRON Guard`, `Мониторинг TRON / USDT`, wallet count, risk beta, and alert status.
4. Confirm the main menu has 8 buttons in 4 rows.
5. Open `Profile` and confirm Telegram ID, username, wallet count, and RU/EN language row.
6. Open `Settings` and confirm owner/service/customer alert descriptions.
7. Add a wallet and confirm dashboard rows are compact with emoji markers.
8. Open `Risk intel` and confirm planned modules are still clearly marked planned/not connected.
9. Press `Back/Menu` buttons from every screen and confirm navigation works.
10. Confirm the bot never asks for private keys, seed phrase, signing, or wallet access.
```

- [ ] **Step 3: Run docs-free verification**

Run:

```bash
npm test
npm run typecheck
git diff --check
```

Expected:

- all tests pass;
- TypeScript passes;
- no whitespace errors, CRLF warnings are acceptable on Windows.

---

## Acceptance Criteria

- `/start` shows compact bilingual product shell.
- Main menu visually resembles high-density Telegram utility bots without copying FeeSaver branding.
- `/profile` and `Profile` callback work.
- Wallet dashboard is shorter and more scannable.
- Settings and alert admin screens are clearer.
- Existing commands and callbacks still work.
- Risk intel remains honest: planned modules are not presented as active.
- No database migrations.
- No changes to monitor/risk/storage behavior.
- `npm test`, `npm run typecheck`, and `git diff --check` pass.

---

## Self-Review

Spec coverage:

- FeeSaver-like compact design: Tasks 1, 3, 4, 5.
- Bilingual RU/EN copy: Tasks 1, 2, 4, 5.
- Menu/buttons: Tasks 1, 2, 3, 4.
- Product safety boundaries: Tasks 5 and 6.
- No heavy forensics: Acceptance criteria and file structure.

Placeholder scan:

- No task contains TBD/TODO placeholders.
- Every implementation step names concrete files and expected commands.

Type consistency:

- New callback kind is `profile`.
- New message function is `profileMessage`.
- New keyboard function is `profileKeyboard`.
- Existing alert-admin callback names remain unchanged.
