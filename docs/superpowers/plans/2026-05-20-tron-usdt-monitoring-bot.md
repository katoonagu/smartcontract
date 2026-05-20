# TRON USDT Monitoring Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only Telegram bot that monitors user-added TRON USDT wallets, analyzes incoming senders, alerts users, and lets whitelisted service admins label suspicious addresses or transactions.

**Architecture:** The service is a Node.js/TypeScript app split into focused modules: Telegram bot interface, TRON data adapter, parser, risk engine, alert formatter, PostgreSQL-backed storage, and monitoring worker. Pure logic is tested first with Vitest; external TRON and Telegram calls are behind interfaces so they can be mocked.

**Tech Stack:** Node.js, TypeScript, grammY, PostgreSQL, pg, TronWeb/Tronscan HTTP adapter, Vitest, Docker.

---

## Source Spec

- `docs/superpowers/specs/2026-05-20-tron-usdt-monitoring-bot-design.md`

## File Structure

Create these files:

- `package.json`: scripts and dependencies.
- `tsconfig.json`: TypeScript compiler config.
- `.env.example`: required environment variables.
- `docker-compose.yml`: local PostgreSQL.
- `vitest.config.ts`: test runner config.
- `migrations/001_init.sql`: database schema.
- `src/index.ts`: application entrypoint.
- `src/config.ts`: environment parsing.
- `src/types.ts`: shared domain types.
- `src/tron/address.ts`: TRON address validation and input classification.
- `src/tron/tronClient.ts`: TRON data interface and Tronscan implementation.
- `src/parser/transactionParser.ts`: convert raw TRON records into internal events.
- `src/risk/riskEngine.ts`: rule-based risk scoring.
- `src/check/manualCheck.ts`: manual address and transaction-hash checks.
- `src/alerts/formatters.ts`: user and admin alert messages.
- `src/storage/db.ts`: PostgreSQL connection.
- `src/storage/repositories.ts`: data access functions.
- `src/bot/createBot.ts`: user and admin Telegram commands.
- `src/monitor/monitorWorker.ts`: polling loop and alert dispatch.
- `tests/tron/address.test.ts`: address/input tests.
- `tests/parser/transactionParser.test.ts`: parser tests.
- `tests/risk/riskEngine.test.ts`: scoring tests.
- `tests/check/manualCheck.test.ts`: manual address and tx hash check tests.
- `tests/alerts/formatters.test.ts`: message formatting tests.
- `tests/monitor/monitorWorker.test.ts`: idempotent monitoring tests.

---

### Task 1: Scaffold Project and Config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `src/config.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Create package and TypeScript config**

Write `package.json`:

```json
{
  "name": "tron-usdt-monitoring-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:migrate": "psql \"$DATABASE_URL\" -f migrations/001_init.sql"
  },
  "dependencies": {
    "@grammyjs/auto-retry": "^2.0.1",
    "dotenv": "^16.4.7",
    "grammy": "^1.33.0",
    "pg": "^8.13.1",
    "tronweb": "^6.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Write `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist"
  },
  "include": ["src", "tests", "vitest.config.ts"]
}
```

Write `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

- [ ] **Step 2: Create local environment files**

Write `.env.example`:

```text
BOT_TOKEN=replace_with_telegram_bot_token
DATABASE_URL=postgres://postgres:postgres@localhost:5432/tron_guard
TRONSCAN_BASE_URL=https://apilist.tronscanapi.com
POLL_INTERVAL_MS=60000
SERVICE_ADMIN_TG_IDS=123456789,987654321
```

Write `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: tron_guard
    ports:
      - "5432:5432"
    volumes:
      - tron_guard_pg:/var/lib/postgresql/data

volumes:
  tron_guard_pg:
```

- [ ] **Step 3: Define shared types**

Write `src/types.ts`:

```ts
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskLabel =
  | "scam"
  | "stolen_funds"
  | "phishing"
  | "mule"
  | "collector"
  | "bridge"
  | "exchange"
  | "trusted"
  | "false_positive"
  | "needs_review"
  | "mixer_like"
  | "risky_contract";

export type WatchedWallet = {
  id: string;
  telegramUserId: string;
  telegramUsername: string | null;
  address: string;
  createdAt: Date;
};

export type TronTransferEvent = {
  txHash: string;
  token: "USDT";
  sender: string;
  receiver: string;
  amount: string;
  timestamp: Date;
};

export type AddressLabel = {
  address: string;
  label: RiskLabel;
  source: "service_admin" | "system";
  createdByTelegramId: string | null;
  createdAt: Date;
};

export type RiskReason = {
  code: string;
  message: string;
  scoreImpact: number;
};

export type RiskReport = {
  subjectAddress: string;
  level: RiskLevel;
  score: number;
  reasons: RiskReason[];
};
```

- [ ] **Step 4: Implement environment parsing**

Write `src/config.ts`:

```ts
import "dotenv/config";

export type AppConfig = {
  botToken: string;
  databaseUrl: string;
  tronscanBaseUrl: string;
  pollIntervalMs: number;
  serviceAdminTelegramIds: Set<string>;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const rawAdminIds = process.env.SERVICE_ADMIN_TG_IDS ?? "";
  const adminIds = rawAdminIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return {
    botToken: requireEnv("BOT_TOKEN"),
    databaseUrl: requireEnv("DATABASE_URL"),
    tronscanBaseUrl: process.env.TRONSCAN_BASE_URL ?? "https://apilist.tronscanapi.com",
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "60000"),
    serviceAdminTelegramIds: new Set(adminIds)
  };
}
```

- [ ] **Step 5: Verify setup**

Run:

```bash
npm install
npm run typecheck
npm test
```

Expected:

```text
tsc exits 0
vitest exits 0 with no test files or with empty suite warning depending on Vitest version
```

- [ ] **Step 6: Commit**

```bash
git init
git add package.json tsconfig.json vitest.config.ts .env.example docker-compose.yml src/config.ts src/types.ts
git commit -m "chore: scaffold tron monitoring bot"
```

---

### Task 2: TRON Address Validation and Input Classification

**Files:**
- Create: `src/tron/address.ts`
- Create: `tests/tron/address.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/tron/address.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyInput, isLikelyTronAddress, isLikelyTronTxHash } from "../../src/tron/address";

describe("tron input helpers", () => {
  it("accepts base58 TRON addresses that start with T", () => {
    expect(isLikelyTronAddress("TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d")).toBe(true);
  });

  it("rejects short or malformed addresses", () => {
    expect(isLikelyTronAddress("TDwx")).toBe(false);
    expect(isLikelyTronAddress("0x3c38a410a09539b9bdeea3e5723dbf68c2d282da")).toBe(false);
  });

  it("accepts 64 character transaction hashes", () => {
    expect(isLikelyTronTxHash("aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2")).toBe(true);
  });

  it("classifies address, transaction hash, and unknown input", () => {
    expect(classifyInput("TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d")).toEqual({
      kind: "tron_address",
      value: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d"
    });
    expect(classifyInput("aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2").kind).toBe("tron_tx");
    expect(classifyInput("hello").kind).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/tron/address.test.ts
```

Expected: FAIL because `src/tron/address.ts` does not exist.

- [ ] **Step 3: Implement validation helpers**

Write `src/tron/address.ts`:

```ts
export type ClassifiedInput =
  | { kind: "tron_address"; value: string }
  | { kind: "tron_tx"; value: string }
  | { kind: "unknown"; value: string };

const TRON_BASE58_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TX_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;

export function isLikelyTronAddress(value: string): boolean {
  return TRON_BASE58_PATTERN.test(value.trim());
}

export function isLikelyTronTxHash(value: string): boolean {
  return TX_HASH_PATTERN.test(value.trim());
}

export function classifyInput(input: string): ClassifiedInput {
  const value = input.trim();
  if (isLikelyTronAddress(value)) return { kind: "tron_address", value };
  if (isLikelyTronTxHash(value)) return { kind: "tron_tx", value: value.toLowerCase() };
  return { kind: "unknown", value };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- tests/tron/address.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tron/address.ts tests/tron/address.test.ts
git commit -m "feat: classify tron bot inputs"
```

---

### Task 3: Database Schema and Repositories

**Files:**
- Create: `migrations/001_init.sql`
- Create: `src/storage/db.ts`
- Create: `src/storage/repositories.ts`

- [ ] **Step 1: Write database schema**

Write `migrations/001_init.sql`:

```sql
create extension if not exists "uuid-ossp";

create table if not exists telegram_users (
  telegram_user_id text primary key,
  username text,
  created_at timestamptz not null default now()
);

create table if not exists watched_wallets (
  id uuid primary key default uuid_generate_v4(),
  telegram_user_id text not null references telegram_users(telegram_user_id) on delete cascade,
  address text not null,
  created_at timestamptz not null default now(),
  unique (telegram_user_id, address)
);

create table if not exists observed_transactions (
  tx_hash text primary key,
  watched_wallet_id uuid not null references watched_wallets(id) on delete cascade,
  sender text not null,
  receiver text not null,
  token text not null,
  amount text not null,
  timestamp timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists address_labels (
  address text not null,
  label text not null,
  source text not null,
  created_by_telegram_id text,
  created_at timestamptz not null default now(),
  primary key (address, label)
);

create table if not exists transaction_labels (
  tx_hash text not null,
  label text not null,
  source text not null,
  created_by_telegram_id text,
  created_at timestamptz not null default now(),
  primary key (tx_hash, label)
);

create table if not exists risk_reports (
  id uuid primary key default uuid_generate_v4(),
  tx_hash text,
  subject_address text not null,
  level text not null,
  score integer not null,
  reasons jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists watched_wallets_address_idx on watched_wallets(address);
create index if not exists observed_transactions_watched_wallet_id_idx on observed_transactions(watched_wallet_id);
create index if not exists address_labels_address_idx on address_labels(address);
```

- [ ] **Step 2: Implement database connection**

Write `src/storage/db.ts`:

```ts
import pg from "pg";

export type Db = pg.Pool;

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl });
}

export async function closeDb(db: Db): Promise<void> {
  await db.end();
}
```

- [ ] **Step 3: Implement repositories**

Write `src/storage/repositories.ts`:

```ts
import type { AddressLabel, RiskLabel, TronTransferEvent, WatchedWallet } from "../types";
import type { Db } from "./db";

export async function upsertTelegramUser(db: Db, input: { telegramUserId: string; username: string | null }): Promise<void> {
  await db.query(
    `insert into telegram_users (telegram_user_id, username)
     values ($1, $2)
     on conflict (telegram_user_id) do update set username = excluded.username`,
    [input.telegramUserId, input.username]
  );
}

export async function addWatchedWallet(db: Db, input: { telegramUserId: string; address: string }): Promise<WatchedWallet> {
  const result = await db.query(
    `insert into watched_wallets (telegram_user_id, address)
     values ($1, $2)
     on conflict (telegram_user_id, address) do update set address = excluded.address
     returning id, telegram_user_id, address, created_at`,
    [input.telegramUserId, input.address]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: null,
    address: row.address,
    createdAt: row.created_at
  };
}

export async function listWatchedWallets(db: Db, telegramUserId?: string): Promise<WatchedWallet[]> {
  const query = telegramUserId
    ? `select w.id, w.telegram_user_id, u.username, w.address, w.created_at
       from watched_wallets w join telegram_users u on u.telegram_user_id = w.telegram_user_id
       where w.telegram_user_id = $1 order by w.created_at asc`
    : `select w.id, w.telegram_user_id, u.username, w.address, w.created_at
       from watched_wallets w join telegram_users u on u.telegram_user_id = w.telegram_user_id
       order by w.created_at asc`;
  const result = await db.query(query, telegramUserId ? [telegramUserId] : []);
  return result.rows.map((row) => ({
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.username,
    address: row.address,
    createdAt: row.created_at
  }));
}

export async function removeWatchedWallet(db: Db, input: { telegramUserId: string; address: string }): Promise<boolean> {
  const result = await db.query(
    `delete from watched_wallets where telegram_user_id = $1 and address = $2`,
    [input.telegramUserId, input.address]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function hasObservedTransaction(db: Db, txHash: string): Promise<boolean> {
  const result = await db.query(`select 1 from observed_transactions where tx_hash = $1`, [txHash]);
  return result.rowCount === 1;
}

export async function saveObservedTransaction(db: Db, input: { watchedWalletId: string; event: TronTransferEvent }): Promise<void> {
  await db.query(
    `insert into observed_transactions (tx_hash, watched_wallet_id, sender, receiver, token, amount, timestamp)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (tx_hash) do nothing`,
    [input.event.txHash, input.watchedWalletId, input.event.sender, input.event.receiver, input.event.token, input.event.amount, input.event.timestamp]
  );
}

export async function saveAddressLabel(
  db: Db,
  input: { address: string; label: RiskLabel; source: "service_admin" | "system"; createdByTelegramId: string | null }
): Promise<void> {
  await db.query(
    `insert into address_labels (address, label, source, created_by_telegram_id)
     values ($1, $2, $3, $4)
     on conflict (address, label) do update set source = excluded.source, created_by_telegram_id = excluded.created_by_telegram_id`,
    [input.address, input.label, input.source, input.createdByTelegramId]
  );
}

export async function listAddressLabels(db: Db, address: string): Promise<AddressLabel[]> {
  const result = await db.query(
    `select address, label, source, created_by_telegram_id, created_at
     from address_labels where address = $1 order by created_at asc`,
    [address]
  );
  return result.rows.map((row) => ({
    address: row.address,
    label: row.label,
    source: row.source,
    createdByTelegramId: row.created_by_telegram_id,
    createdAt: row.created_at
  }));
}
```

- [ ] **Step 4: Run migration locally**

Run:

```bash
docker compose up -d postgres
cp .env.example .env
npm run db:migrate
```

Expected: migration exits 0 and tables exist in PostgreSQL.

- [ ] **Step 5: Run checks and commit**

```bash
npm run typecheck
git add migrations/001_init.sql src/storage/db.ts src/storage/repositories.ts
git commit -m "feat: add storage schema and repositories"
```

---

### Task 4: Transaction Parser

**Files:**
- Create: `src/parser/transactionParser.ts`
- Create: `tests/parser/transactionParser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Write `tests/parser/transactionParser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTrc20IncomingTransfer } from "../../src/parser/transactionParser";

describe("parseTrc20IncomingTransfer", () => {
  it("parses a TRC20 USDT incoming transfer from a Tronscan-like record", () => {
    const parsed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "12450000000",
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6 },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(parsed).toEqual({
      txHash: "abc123",
      token: "USDT",
      sender: "TSender111111111111111111111111111111",
      receiver: "TReceiver11111111111111111111111111111",
      amount: "12450",
      timestamp: new Date(1779220000000)
    });
  });

  it("returns null for non-USDT transfers", () => {
    const parsed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "1000000",
        tokenInfo: { tokenAbbr: "TRX", tokenDecimal: 6 },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(parsed).toBeNull();
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
npm test -- tests/parser/transactionParser.test.ts
```

Expected: FAIL because parser file does not exist.

- [ ] **Step 3: Implement parser**

Write `src/parser/transactionParser.ts`:

```ts
import type { TronTransferEvent } from "../types";

export type RawTronscanTrc20Transfer = {
  transaction_id: string;
  from_address: string;
  to_address: string;
  quant: string;
  tokenInfo?: {
    tokenAbbr?: string;
    tokenDecimal?: number;
  };
  block_ts: number;
};

function formatTokenAmount(rawAmount: string, decimals: number): string {
  const value = BigInt(rawAmount);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();
  const padded = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${padded}`;
}

export function parseTrc20IncomingTransfer(
  raw: RawTronscanTrc20Transfer,
  watchedAddress: string
): TronTransferEvent | null {
  if (raw.to_address !== watchedAddress) return null;
  if (raw.tokenInfo?.tokenAbbr !== "USDT") return null;

  return {
    txHash: raw.transaction_id,
    token: "USDT",
    sender: raw.from_address,
    receiver: raw.to_address,
    amount: formatTokenAmount(raw.quant, raw.tokenInfo.tokenDecimal ?? 6),
    timestamp: new Date(raw.block_ts)
  };
}
```

- [ ] **Step 4: Run parser tests**

```bash
npm test -- tests/parser/transactionParser.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parser/transactionParser.ts tests/parser/transactionParser.test.ts
git commit -m "feat: parse trc20 incoming transfers"
```

---

### Task 5: Risk Engine

**Files:**
- Create: `src/risk/riskEngine.ts`
- Create: `tests/risk/riskEngine.test.ts`

- [ ] **Step 1: Write failing risk tests**

Write `tests/risk/riskEngine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calculateRisk } from "../../src/risk/riskEngine";

describe("calculateRisk", () => {
  it("returns LOW when no risk signals exist", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [],
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: []
    });

    expect(report.level).toBe("LOW");
    expect(report.score).toBe(0);
    expect(report.reasons).toEqual([]);
  });

  it("returns CRITICAL for internal scam labels", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [{ address: "TSubject111111111111111111111111111111", label: "scam", source: "service_admin", createdByTelegramId: "1", createdAt: new Date() }],
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: []
    });

    expect(report.level).toBe("CRITICAL");
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.reasons[0].code).toBe("internal_label_scam");
  });

  it("combines graph and behavior signals into HIGH", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [],
      graphSignals: [{ code: "risky_1_hop", message: "1-hop connection to risky address", scoreImpact: 35 }],
      behaviorSignals: [{ code: "split_pattern", message: "Repeated split transfers detected", scoreImpact: 30 }],
      amlSignals: []
    });

    expect(report.level).toBe("HIGH");
    expect(report.score).toBe(65);
    expect(report.reasons.map((reason) => reason.code)).toEqual(["risky_1_hop", "split_pattern"]);
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npm test -- tests/risk/riskEngine.test.ts
```

Expected: FAIL because risk engine file does not exist.

- [ ] **Step 3: Implement risk engine**

Write `src/risk/riskEngine.ts`:

```ts
import type { AddressLabel, RiskReason, RiskReport } from "../types";

export type RiskSignal = {
  code: string;
  message: string;
  scoreImpact: number;
};

export type CalculateRiskInput = {
  subjectAddress: string;
  labels: AddressLabel[];
  graphSignals: RiskSignal[];
  behaviorSignals: RiskSignal[];
  amlSignals: RiskSignal[];
};

function levelFromScore(score: number): RiskReport["level"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function reasonsFromLabels(labels: AddressLabel[]): RiskReason[] {
  return labels.map((label) => {
    if (label.label === "trusted" || label.label === "false_positive") {
      return {
        code: `internal_label_${label.label}`,
        message: `Internal label: ${label.label}`,
        scoreImpact: -40
      };
    }

    const criticalLabels = new Set(["scam", "stolen_funds", "phishing", "mixer_like", "risky_contract"]);
    return {
      code: `internal_label_${label.label}`,
      message: `Internal label: ${label.label}`,
      scoreImpact: criticalLabels.has(label.label) ? 90 : 35
    };
  });
}

export function calculateRisk(input: CalculateRiskInput): RiskReport {
  const reasons = [
    ...reasonsFromLabels(input.labels),
    ...input.graphSignals,
    ...input.behaviorSignals,
    ...input.amlSignals
  ];

  const score = Math.max(
    0,
    Math.min(
      100,
      reasons.reduce((sum, reason) => sum + reason.scoreImpact, 0)
    )
  );

  return {
    subjectAddress: input.subjectAddress,
    level: levelFromScore(score),
    score,
    reasons: reasons.filter((reason) => reason.scoreImpact !== 0)
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/risk/riskEngine.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/risk/riskEngine.ts tests/risk/riskEngine.test.ts
git commit -m "feat: add explainable risk engine"
```

---

### Task 6: Alert Formatters

**Files:**
- Create: `src/alerts/formatters.ts`
- Create: `tests/alerts/formatters.test.ts`

- [ ] **Step 1: Write failing formatter tests**

Write `tests/alerts/formatters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatAdminSuspiciousAlert, formatUserIncomingAlert } from "../../src/alerts/formatters";

const report = {
  subjectAddress: "TSender111111111111111111111111111111",
  level: "HIGH" as const,
  score: 82,
  reasons: [
    { code: "split_pattern", message: "Repeated split transfers detected", scoreImpact: 30 },
    { code: "risky_1_hop", message: "1-hop connection to risky address", scoreImpact: 35 }
  ]
};

describe("alert formatters", () => {
  it("formats user incoming alert with score and reasons", () => {
    const text = formatUserIncomingAlert({
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    });

    expect(text).toContain("Incoming USDT: 12450");
    expect(text).toContain("Risk: HIGH - 82/100");
    expect(text).toContain("Repeated split transfers detected");
  });

  it("formats admin alert with Telegram owner identity", () => {
    const text = formatAdminSuspiciousAlert({
      telegramUserId: "123456789",
      telegramUsername: "client_user",
      watchedWallet: "TWallet111111111111111111111111111111",
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    });

    expect(text).toContain("User: @client_user - tg_id: 123456789");
    expect(text).toContain("Watched wallet: TWallet111111111111111111111111111111");
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npm test -- tests/alerts/formatters.test.ts
```

Expected: FAIL because formatter file does not exist.

- [ ] **Step 3: Implement formatters**

Write `src/alerts/formatters.ts`:

```ts
import type { RiskReport } from "../types";

function formatReasons(report: RiskReport): string {
  if (report.reasons.length === 0) return "- no obvious risk signals found";
  return report.reasons.map((reason) => `- ${reason.message}`).join("\n");
}

export function formatUserIncomingAlert(input: {
  amount: string;
  sender: string;
  txHash: string;
  report: RiskReport;
}): string {
  return [
    `Incoming USDT: ${input.amount}`,
    `From: ${input.sender}`,
    `Risk: ${input.report.level} - ${input.report.score}/100`,
    "",
    "Reasons:",
    formatReasons(input.report),
    "",
    `Tx: ${input.txHash}`
  ].join("\n");
}

export function formatAdminSuspiciousAlert(input: {
  telegramUserId: string;
  telegramUsername: string | null;
  watchedWallet: string;
  amount: string;
  sender: string;
  txHash: string;
  report: RiskReport;
}): string {
  const user = input.telegramUsername
    ? `@${input.telegramUsername} - tg_id: ${input.telegramUserId}`
    : `tg_id: ${input.telegramUserId}`;

  return [
    `${input.report.level} incoming event`,
    `User: ${user}`,
    `Watched wallet: ${input.watchedWallet}`,
    `Sender: ${input.sender}`,
    `Amount: ${input.amount} USDT`,
    `Score: ${input.report.score}/100`,
    "",
    "Reasons:",
    formatReasons(input.report),
    "",
    `Tx: ${input.txHash}`
  ].join("\n");
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/alerts/formatters.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/alerts/formatters.ts tests/alerts/formatters.test.ts
git commit -m "feat: format risk alerts"
```

---

### Task 7: TRON Client Adapter

**Files:**
- Create: `src/tron/tronClient.ts`

- [ ] **Step 1: Implement TRON client interface and Tronscan adapter**

Write `src/tron/tronClient.ts`:

```ts
import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";

export type TronClient = {
  listIncomingTrc20Transfers(address: string): Promise<RawTronscanTrc20Transfer[]>;
  getTransaction(txHash: string): Promise<unknown>;
};

export class TronscanClient implements TronClient {
  constructor(private readonly baseUrl: string) {}

  async listIncomingTrc20Transfers(address: string): Promise<RawTronscanTrc20Transfer[]> {
    const url = new URL("/api/token_trc20/transfers", this.baseUrl);
    url.searchParams.set("relatedAddress", address);
    url.searchParams.set("limit", "50");
    url.searchParams.set("start", "0");
    url.searchParams.set("sort", "-timestamp");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Tronscan transfer request failed: ${response.status}`);
    }

    const json = (await response.json()) as { token_transfers?: RawTronscanTrc20Transfer[] };
    return json.token_transfers ?? [];
  }

  async getTransaction(txHash: string): Promise<unknown> {
    const url = new URL("/api/transaction-info", this.baseUrl);
    url.searchParams.set("hash", txHash);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Tronscan transaction request failed: ${response.status}`);
    }

    return response.json();
  }
}
```

- [ ] **Step 2: Run checks**

```bash
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tron/tronClient.ts
git commit -m "feat: add tronscan client adapter"
```

---

### Task 8: Manual Check Service

**Files:**
- Create: `src/check/manualCheck.ts`
- Create: `tests/check/manualCheck.test.ts`

- [ ] **Step 1: Write failing manual check tests**

Write `tests/check/manualCheck.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkAddress, checkTransactionHash } from "../../src/check/manualCheck";

describe("manual checks", () => {
  it("checks an address using stored labels", async () => {
    const result = await checkAddress("TSubject111111111111111111111111111111", {
      getLabelsForAddress: async () => [
        {
          address: "TSubject111111111111111111111111111111",
          label: "scam",
          source: "service_admin",
          createdByTelegramId: "1",
          createdAt: new Date()
        }
      ]
    });

    expect(result.report.level).toBe("CRITICAL");
    expect(result.subjectAddress).toBe("TSubject111111111111111111111111111111");
  });

  it("checks a transaction hash by extracting the TRC20 sender", async () => {
    const result = await checkTransactionHash("abc123", {
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {
            trc20TransferInfo: [
              {
                from_address: "TSender111111111111111111111111111111"
              }
            ]
          };
        }
      },
      getLabelsForAddress: async () => []
    });

    expect(result.subjectAddress).toBe("TSender111111111111111111111111111111");
    expect(result.report.level).toBe("LOW");
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npm test -- tests/check/manualCheck.test.ts
```

Expected: FAIL because manual check file does not exist.

- [ ] **Step 3: Implement manual check service**

Write `src/check/manualCheck.ts`:

```ts
import { calculateRisk } from "../risk/riskEngine";
import type { AddressLabel, RiskReport } from "../types";
import type { TronClient } from "../tron/tronClient";

export type ManualAddressCheckDeps = {
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
};

export type ManualTransactionCheckDeps = ManualAddressCheckDeps & {
  tronClient: TronClient;
};

export type ManualCheckResult = {
  subjectAddress: string;
  report: RiskReport;
};

function extractSenderFromTransactionInfo(raw: unknown): string | null {
  const record = raw as {
    trc20TransferInfo?: Array<{ from_address?: string }>;
    contractData?: { owner_address?: string };
    ownerAddress?: string;
  };

  return (
    record.trc20TransferInfo?.[0]?.from_address ??
    record.contractData?.owner_address ??
    record.ownerAddress ??
    null
  );
}

export async function checkAddress(address: string, deps: ManualAddressCheckDeps): Promise<ManualCheckResult> {
  const labels = await deps.getLabelsForAddress(address);
  const report = calculateRisk({
    subjectAddress: address,
    labels,
    graphSignals: [],
    behaviorSignals: [],
    amlSignals: []
  });

  return { subjectAddress: address, report };
}

export async function checkTransactionHash(txHash: string, deps: ManualTransactionCheckDeps): Promise<ManualCheckResult> {
  const raw = await deps.tronClient.getTransaction(txHash);
  const sender = extractSenderFromTransactionInfo(raw);
  if (!sender) {
    throw new Error(`Could not extract sender from transaction: ${txHash}`);
  }

  return checkAddress(sender, deps);
}
```

- [ ] **Step 4: Run manual check tests**

```bash
npm test -- tests/check/manualCheck.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check/manualCheck.ts tests/check/manualCheck.test.ts
git commit -m "feat: add manual address and transaction checks"
```

---

### Task 9: Monitor Worker

**Files:**
- Create: `src/monitor/monitorWorker.ts`
- Create: `tests/monitor/monitorWorker.test.ts`

- [ ] **Step 1: Write failing worker test**

Write `tests/monitor/monitorWorker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runSinglePollingCycle } from "../../src/monitor/monitorWorker";

describe("runSinglePollingCycle", () => {
  it("alerts once for a new incoming transfer and skips already observed tx", async () => {
    const sentMessages: string[] = [];
    const observed = new Set<string>();

    await runSinglePollingCycle({
      wallets: [
        {
          id: "wallet-1",
          telegramUserId: "123",
          telegramUsername: "client_user",
          address: "TReceiver11111111111111111111111111111",
          createdAt: new Date()
        }
      ],
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [
            {
              transaction_id: "tx1",
              from_address: "TSender111111111111111111111111111111",
              to_address: "TReceiver11111111111111111111111111111",
              quant: "1000000",
              tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6 },
              block_ts: 1779220000000
            }
          ];
        },
        async getTransaction() {
          return {};
        }
      },
      hasObservedTransaction: async (txHash) => observed.has(txHash),
      saveObservedTransaction: async ({ event }) => {
        observed.add(event.txHash);
      },
      getLabelsForAddress: async () => [],
      sendUserAlert: async (_telegramUserId, message) => {
        sentMessages.push(message);
      },
      sendAdminAlert: async () => {}
    });

    await runSinglePollingCycle({
      wallets: [
        {
          id: "wallet-1",
          telegramUserId: "123",
          telegramUsername: "client_user",
          address: "TReceiver11111111111111111111111111111",
          createdAt: new Date()
        }
      ],
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [
            {
              transaction_id: "tx1",
              from_address: "TSender111111111111111111111111111111",
              to_address: "TReceiver11111111111111111111111111111",
              quant: "1000000",
              tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6 },
              block_ts: 1779220000000
            }
          ];
        },
        async getTransaction() {
          return {};
        }
      },
      hasObservedTransaction: async (txHash) => observed.has(txHash),
      saveObservedTransaction: async ({ event }) => {
        observed.add(event.txHash);
      },
      getLabelsForAddress: async () => [],
      sendUserAlert: async (_telegramUserId, message) => {
        sentMessages.push(message);
      },
      sendAdminAlert: async () => {}
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("Incoming USDT: 1");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
npm test -- tests/monitor/monitorWorker.test.ts
```

Expected: FAIL because worker file does not exist.

- [ ] **Step 3: Implement worker**

Write `src/monitor/monitorWorker.ts`:

```ts
import { formatAdminSuspiciousAlert, formatUserIncomingAlert } from "../alerts/formatters";
import { parseTrc20IncomingTransfer } from "../parser/transactionParser";
import { calculateRisk } from "../risk/riskEngine";
import type { AddressLabel, TronTransferEvent, WatchedWallet } from "../types";
import type { TronClient } from "../tron/tronClient";

export type PollingCycleDeps = {
  wallets: WatchedWallet[];
  tronClient: TronClient;
  hasObservedTransaction(txHash: string): Promise<boolean>;
  saveObservedTransaction(input: { watchedWalletId: string; event: TronTransferEvent }): Promise<void>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  sendUserAlert(telegramUserId: string, message: string): Promise<void>;
  sendAdminAlert(message: string): Promise<void>;
};

function shouldNotifyAdmins(level: string): boolean {
  return level === "HIGH" || level === "CRITICAL";
}

export async function runSinglePollingCycle(deps: PollingCycleDeps): Promise<void> {
  for (const wallet of deps.wallets) {
    const rawTransfers = await deps.tronClient.listIncomingTrc20Transfers(wallet.address);

    for (const rawTransfer of rawTransfers) {
      const event = parseTrc20IncomingTransfer(rawTransfer, wallet.address);
      if (!event) continue;
      if (await deps.hasObservedTransaction(event.txHash)) continue;

      const labels = await deps.getLabelsForAddress(event.sender);
      const report = calculateRisk({
        subjectAddress: event.sender,
        labels,
        graphSignals: [],
        behaviorSignals: [],
        amlSignals: []
      });

      await deps.saveObservedTransaction({ watchedWalletId: wallet.id, event });

      await deps.sendUserAlert(
        wallet.telegramUserId,
        formatUserIncomingAlert({
          amount: event.amount,
          sender: event.sender,
          txHash: event.txHash,
          report
        })
      );

      if (shouldNotifyAdmins(report.level)) {
        await deps.sendAdminAlert(
          formatAdminSuspiciousAlert({
            telegramUserId: wallet.telegramUserId,
            telegramUsername: wallet.telegramUsername,
            watchedWallet: wallet.address,
            amount: event.amount,
            sender: event.sender,
            txHash: event.txHash,
            report
          })
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run worker tests**

```bash
npm test -- tests/monitor/monitorWorker.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/monitorWorker.ts tests/monitor/monitorWorker.test.ts
git commit -m "feat: monitor incoming tron transfers"
```

---

### Task 10: Telegram Bot Commands

**Files:**
- Create: `src/bot/createBot.ts`

- [ ] **Step 1: Implement bot factory**

Write `src/bot/createBot.ts`:

```ts
import { Bot } from "grammy";
import type { AppConfig } from "../config";
import { classifyInput } from "../tron/address";
import type { TronClient } from "../tron/tronClient";
import type { Db } from "../storage/db";
import {
  addWatchedWallet,
  listAddressLabels,
  listWatchedWallets,
  removeWatchedWallet,
  saveAddressLabel,
  upsertTelegramUser
} from "../storage/repositories";
import { checkAddress, checkTransactionHash } from "../check/manualCheck";
import type { RiskLabel, RiskReport } from "../types";

const ALLOWED_LABELS = new Set<RiskLabel>([
  "scam",
  "stolen_funds",
  "phishing",
  "mule",
  "collector",
  "bridge",
  "exchange",
  "trusted",
  "false_positive",
  "needs_review",
  "mixer_like",
  "risky_contract"
]);

function telegramId(ctx: { from?: { id: number } }): string {
  if (!ctx.from?.id) throw new Error("Telegram user id is missing");
  return String(ctx.from.id);
}

function isServiceAdmin(config: AppConfig, id: string): boolean {
  return config.serviceAdminTelegramIds.has(id);
}

function formatManualReport(report: RiskReport): string {
  const reasons = report.reasons.length
    ? report.reasons.map((reason) => `- ${reason.message}`).join("\n")
    : "- no obvious risk signals found";

  return [`Risk: ${report.level} - ${report.score}/100`, "", "Reasons:", reasons].join("\n");
}

export function createBot(config: AppConfig, db: Db, tronClient: TronClient): Bot {
  const bot = new Bot(config.botToken);

  bot.command("start", async (ctx) => {
    const id = telegramId(ctx);
    await upsertTelegramUser(db, {
      telegramUserId: id,
      username: ctx.from?.username ?? null
    });
    await ctx.reply("Send a TRON address to add it for 24/7 USDT monitoring, or use /check <address-or-tx>.");
  });

  bot.command("wallets", async (ctx) => {
    const wallets = await listWatchedWallets(db, telegramId(ctx));
    if (wallets.length === 0) {
      await ctx.reply("No watched wallets yet. Send a TRON address to add one.");
      return;
    }
    await ctx.reply(wallets.map((wallet) => `- ${wallet.address}`).join("\n"));
  });

  bot.command("remove_wallet", async (ctx) => {
    const id = telegramId(ctx);
    const address = ctx.match.trim();
    const removed = await removeWatchedWallet(db, { telegramUserId: id, address });
    await ctx.reply(removed ? `Removed wallet: ${address}` : `Wallet not found: ${address}`);
  });

  bot.command("check", async (ctx) => {
    const input = classifyInput(ctx.match);

    if (input.kind === "tron_address") {
      const result = await checkAddress(input.value, {
        getLabelsForAddress: (address) => listAddressLabels(db, address)
      });
      await ctx.reply(formatManualReport(result.report));
      return;
    }

    if (input.kind === "tron_tx") {
      const result = await checkTransactionHash(input.value, {
        tronClient,
        getLabelsForAddress: (address) => listAddressLabels(db, address)
      });
      await ctx.reply([`Subject: ${result.subjectAddress}`, formatManualReport(result.report)].join("\n"));
      return;
    }

    await ctx.reply("Usage: /check <TRON-address-or-tx-hash>");
  });

  bot.command("mark", async (ctx) => {
    const id = telegramId(ctx);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }

    const [address, rawLabel] = ctx.match.trim().split(/\s+/);
    const label = rawLabel as RiskLabel;
    if (!address || !ALLOWED_LABELS.has(label)) {
      await ctx.reply("Usage: /mark <TRON-address> <label>");
      return;
    }

    await saveAddressLabel(db, {
      address,
      label,
      source: "service_admin",
      createdByTelegramId: id
    });
    await ctx.reply(`Marked ${address} as ${label}.`);
  });

  bot.on("message:text", async (ctx) => {
    const id = telegramId(ctx);
    const input = classifyInput(ctx.message.text);
    await upsertTelegramUser(db, {
      telegramUserId: id,
      username: ctx.from?.username ?? null
    });

    if (input.kind === "tron_address") {
      await addWatchedWallet(db, { telegramUserId: id, address: input.value });
      await ctx.reply(`Monitoring enabled for ${input.value}.`);
      return;
    }

    if (input.kind === "tron_tx") {
      const result = await checkTransactionHash(input.value, {
        tronClient,
        getLabelsForAddress: (address) => listAddressLabels(db, address)
      });
      await ctx.reply([`Subject: ${result.subjectAddress}`, formatManualReport(result.report)].join("\n"));
      return;
    }

    await ctx.reply("Send a TRON address to monitor it, or use /check <TRON-address-or-tx-hash>.");
  });

  return bot;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/bot/createBot.ts
git commit -m "feat: add telegram bot commands"
```

---

### Task 11: Wire Application Entrypoint

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement entrypoint**

Write `src/index.ts`:

```ts
import { loadConfig } from "./config";
import { createBot } from "./bot/createBot";
import { createDb } from "./storage/db";
import { listAddressLabels, listWatchedWallets, hasObservedTransaction, saveObservedTransaction } from "./storage/repositories";
import { TronscanClient } from "./tron/tronClient";
import { runSinglePollingCycle } from "./monitor/monitorWorker";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const tronClient = new TronscanClient(config.tronscanBaseUrl);
const bot = createBot(config, db, tronClient);

async function sendAdminAlert(message: string): Promise<void> {
  for (const adminId of config.serviceAdminTelegramIds) {
    await bot.api.sendMessage(Number(adminId), message);
  }
}

async function pollOnce(): Promise<void> {
  const wallets = await listWatchedWallets(db);
  await runSinglePollingCycle({
    wallets,
    tronClient,
    hasObservedTransaction: (txHash) => hasObservedTransaction(db, txHash),
    saveObservedTransaction: (input) => saveObservedTransaction(db, input),
    getLabelsForAddress: (address) => listAddressLabels(db, address),
    sendUserAlert: async (telegramUserId, message) => {
      await bot.api.sendMessage(Number(telegramUserId), message);
    },
    sendAdminAlert
  });
}

setInterval(() => {
  pollOnce().catch((error) => {
    console.error("Polling cycle failed", error);
  });
}, config.pollIntervalMs);

bot.start({
  onStart: () => {
    console.log("TRON USDT monitoring bot started");
  }
});
```

- [ ] **Step 2: Run checks**

```bash
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 3: Smoke test locally**

Run:

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Expected:

```text
TRON USDT monitoring bot started
```

Stop the process with `Ctrl+C` after the startup message.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire bot and monitoring worker"
```

---

### Task 12: Final Verification and Docs

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Write `README.md`:

```md
# TRON USDT Monitoring Bot

Read-only Telegram bot for monitoring incoming TRC20 USDT transfers on watched TRON wallets.

## What it does

- Adds watched TRON wallets from Telegram.
- Monitors incoming TRC20 USDT.
- Sends risk level, score, and reasons for each incoming transfer.
- Sends HIGH and CRITICAL events to whitelisted service admins.
- Lets service admins label addresses with risk categories.

## What it does not do

- It does not ask for private keys or seed phrases.
- It does not sign transactions.
- It does not control wallets or funds.
- It does not decide payouts.

## Setup

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
npm run dev
```

## Tests

```bash
npm test
npm run typecheck
```
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Check MVP requirements**

Confirm these are true:

```text
User can add a wallet by sending a TRON address.
Incoming TRC20 USDT records can be parsed.
Risk reports include level, score, and reasons.
HIGH and CRITICAL reports can be sent to service admins.
Service admins can label addresses.
The app never asks for or stores private keys.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add setup and safety notes"
```

---

## Spec Coverage Map

- Product scope: Tasks 1, 9, 10, 11.
- User wallet connection: Tasks 2, 3, 10.
- Incoming monitoring: Tasks 4, 7, 9, 11.
- User alert format: Task 6.
- Manual address and tx hash check: Tasks 8, 10.
- Service admin routing: Tasks 6, 9, 11.
- Service admin labels: Tasks 3, 5, 10.
- Risk engine: Task 5.
- Read-only security constraints: Tasks 10, 11, 12.
- MVP defaults: Tasks 7, 9, 11.

## Execution Notes

- Keep the bot read-only throughout implementation.
- Do not request private keys, seed phrases, or wallet signatures.
- Keep external provider calls behind interfaces.
- Use rule-based scoring first so every alert remains explainable.
