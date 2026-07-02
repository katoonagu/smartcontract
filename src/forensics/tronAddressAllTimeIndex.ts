import { createHash } from "node:crypto";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type { TronscanTrc20TransferPage } from "../tron/tronClient";
import type {
  IndexedTronUsdtTransfer,
  TronAddressUsdtCoverageInterval,
  TronAddressUsdtCoverageMode,
  TronAddressUsdtCoverageStatusReason,
  TronAddressUsdtIndexPage,
  TronAddressUsdtIndexProvider,
  TronAddressUsdtIndexState,
  TronAddressUsdtIndexStatus
} from "../types";

// ponytail: TRON mainnet starts here; replace with provider-discovered per-token lower bounds if we index older/non-TRON histories.
const GENESIS_WINDOW_START_MS = Date.UTC(2018, 5, 25);
const DEFAULT_MAX_PAGES_PER_RUN = 200;
const DEFAULT_MAX_WINDOW_SPLIT_DEPTH = 16;
const PROVIDER_CAP_RANGE_TOTAL = 10_000;
const MAX_PROVIDER_PAGE_LIMIT = 50;

type TransferWithProviderFields = RawTronscanTrc20Transfer & {
  block?: unknown;
  event_index?: unknown;
  eventIndex?: unknown;
  log_index?: unknown;
  logIndex?: unknown;
  event_type?: unknown;
  eventType?: unknown;
  method?: unknown;
  method_name?: unknown;
  trigger_name?: unknown;
  caller_address?: unknown;
  owner_address?: unknown;
};

export type IndexTronAddressUsdtHistoryDeps = {
  address: string;
  coverageMode: TronAddressUsdtCoverageMode;
  targetTimestamp?: Date | null;
  initialState?: TronAddressUsdtIndexState | null;
  initialPagesByKey?: ReadonlyMap<string, { rawResponseHash: string | null; canonicalTransferHash: string | null }>;
  pageLimit: number;
  pageBatchSize?: number;
  maxPagesPerRun?: number;
  maxWindowSplitDepth?: number;
  now?: () => Date;
  stopAtTimestamp?: Date | null;
  requestedByJobId?: string | null;
  queuedReason?: string | null;
  onBenchmarkStageTiming?(stage: "apiMs" | "dbWriteMs", elapsedMs: number): Promise<void> | void;
  listTransferPage(
    address: string,
    options: { start: number; limit: number; startTimestamp: number; endTimestamp: number }
  ): Promise<AddressIndexTransferPage>;
  upsertTransfers(transfers: IndexedTronUsdtTransfer[]): Promise<void>;
  countIndexedCounterparties?(address: string): Promise<number>;
  upsertState(input: Partial<TronAddressUsdtIndexState> & {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    status: TronAddressUsdtIndexStatus;
  }): Promise<TronAddressUsdtIndexState>;
  upsertPage(input: Omit<TronAddressUsdtIndexPage, "tokenContract" | "createdAt" | "updatedAt">): Promise<void>;
  upsertCoverageInterval(input: Omit<TronAddressUsdtCoverageInterval, "tokenContract">): Promise<void>;
};

type AddressIndexTransferPage =
  Omit<TronscanTrc20TransferPage, "rawResponseHash" | "canonicalTransferHash">
  & Partial<Pick<TronscanTrc20TransferPage, "rawResponseHash" | "canonicalTransferHash">>;

type TimeWindow = {
  startMs: number;
  endMs: number;
  depth: number;
};

type AuditedPage = {
  provider: Exclude<TronAddressUsdtIndexProvider, "mixed">;
  total: number | null;
  rangeTotal: number | null;
  rawRowsFetched: number;
  rows: IndexedTronUsdtTransfer[];
  rawResponseHash: string;
  canonicalTransferHash: string;
  inconsistent: boolean;
};

type WindowResult = {
  status: "complete" | "partial";
  reason: TronAddressUsdtCoverageStatusReason;
  pagesFetched: number;
  rowsFetched: number;
  uniqueRowsInserted: number;
  provider: TronAddressUsdtIndexProvider | null;
  totalReported: number | null;
  providerCapHit: boolean;
  budgetExhausted: boolean;
  providerInconsistent: boolean;
  newestTransferAt: Date | null;
  oldestTransferAt: Date | null;
  partialRows: IndexedTronUsdtTransfer[];
};

function pageKey(startTimestampMs: number, endTimestampMs: number, startOffset: number): string {
  return `${startTimestampMs}:${endTimestampMs}:${startOffset}`;
}

function integerOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function boolOrFalse(value: unknown): boolean {
  return value === true;
}

function successOrMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "" || value === "SUCCESS";
}

function successStatusOrMissing(value: unknown): boolean {
  return value === undefined || value === null || value === 0 || value === "0" || value === "SUCCESS";
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex");
}

function pageLimit(deps: Pick<IndexTronAddressUsdtHistoryDeps, "pageLimit">): number {
  return Math.min(MAX_PROVIDER_PAGE_LIMIT, Math.max(1, Math.floor(deps.pageLimit)));
}

function pageBatchSize(deps: Pick<IndexTronAddressUsdtHistoryDeps, "pageBatchSize">): number {
  return Math.max(1, Math.floor(deps.pageBatchSize ?? 1));
}

function providerEventIndex(transfer: RawTronscanTrc20Transfer): number | null {
  const raw = transfer as TransferWithProviderFields;
  return integerOrNull(raw.event_index ?? raw.eventIndex);
}

function providerLogIndex(transfer: RawTronscanTrc20Transfer): number | null {
  const raw = transfer as TransferWithProviderFields;
  return integerOrNull(raw.log_index ?? raw.logIndex);
}

function blockNumber(transfer: RawTronscanTrc20Transfer): number {
  return integerOrNull((transfer as TransferWithProviderFields).block) ?? 0;
}

function eventType(transfer: RawTronscanTrc20Transfer): string | null {
  const raw = transfer as TransferWithProviderFields;
  return stringOrNull(raw.event_type ?? raw.eventType);
}

function methodName(transfer: RawTronscanTrc20Transfer): "transfer" | "transferFrom" {
  const raw = transfer as TransferWithProviderFields;
  const text = [
    raw.method,
    raw.method_name,
    raw.trigger_name,
    transfer.trigger_info
  ].map((value) => typeof value === "string" ? value : JSON.stringify(value) ?? "").join(" ").toLowerCase();
  return text.includes("transferfrom") || text.includes("23b872dd") ? "transferFrom" : "transfer";
}

function fallbackOrdinalInTx(transfer: RawTronscanTrc20Transfer, ordinalInTx?: number | null): number | null {
  return providerEventIndex(transfer) === null && providerLogIndex(transfer) === null
    ? ordinalInTx ?? 0
    : null;
}

function stableTransferId(
  provider: TronAddressUsdtIndexProvider,
  transfer: RawTronscanTrc20Transfer,
  ordinalInTx?: number | null
): string {
  const digest = sha256Json([
    provider,
    transfer.transaction_id,
    eventType(transfer),
    methodName(transfer),
    transfer.from_address,
    transfer.to_address,
    transfer.contract_address ?? transfer.tokenInfo?.tokenId ?? null,
    transfer.quant,
    transfer.block_ts,
    blockNumber(transfer),
    providerEventIndex(transfer),
    providerLogIndex(transfer),
    fallbackOrdinalInTx(transfer, ordinalInTx)
  ]);
  return `${provider}:${digest}`;
}

function stableEventIndex(
  provider: TronAddressUsdtIndexProvider,
  transfer: RawTronscanTrc20Transfer,
  ordinalInTx?: number | null
): number {
  const explicit = providerEventIndex(transfer) ?? providerLogIndex(transfer);
  if (explicit !== null) return explicit;
  return Number.parseInt(sha256Json(stableTransferId(provider, transfer, ordinalInTx)).slice(0, 7), 16);
}

export function shouldIndexCanonicalTronscanUsdtTransfer(transfer: RawTronscanTrc20Transfer): boolean {
  const contract = transfer.contract_address ?? transfer.tokenInfo?.tokenId;
  const transferEventType = eventType(transfer);
  return contract === TRON_USDT_CONTRACT_ADDRESS
    && (transferEventType === null || transferEventType.toLowerCase() === "transfer")
    && transfer.confirmed === true
    && successOrMissing(transfer.contractRet)
    && successOrMissing(transfer.finalResult)
    && successStatusOrMissing(transfer.status)
    && transfer.revert !== true
    && boolOrFalse(transfer.riskTransaction) === false
    && stringOrNull(transfer.transaction_id) !== null
    && stringOrNull(transfer.from_address) !== null
    && stringOrNull(transfer.to_address) !== null
    && stringOrNull(transfer.quant) !== null
    && typeof transfer.block_ts === "number"
    && Number.isFinite(transfer.block_ts);
}

export function normalizeTronscanTransferForAddressIndex(
  raw: RawTronscanTrc20Transfer,
  provider: TronAddressUsdtIndexProvider = "tronscan",
  ordinalInTx?: number | null
): IndexedTronUsdtTransfer {
  const providerFields = raw as TransferWithProviderFields;
  return {
    transferId: stableTransferId(provider, raw, ordinalInTx),
    provider,
    txHash: raw.transaction_id,
    blockNumber: blockNumber(raw),
    blockTimestamp: new Date(raw.block_ts),
    eventIndex: stableEventIndex(provider, raw, ordinalInTx),
    providerRowOrdinalInTx: fallbackOrdinalInTx(raw, ordinalInTx),
    fromAddress: raw.from_address,
    toAddress: raw.to_address,
    amountRaw: raw.quant,
    method: methodName(raw),
    eventType: eventType(raw),
    callerAddress: stringOrNull(providerFields.caller_address ?? providerFields.owner_address),
    contractRet: raw.contractRet ?? null,
    finalResult: raw.finalResult ?? null,
    reverted: raw.revert === true,
    riskTransaction: raw.riskTransaction === true,
    confirmed: raw.confirmed === true
  };
}

function canonicalTransferHash(page: AddressIndexTransferPage, rows: IndexedTronUsdtTransfer[]): string {
  return page.canonicalTransferHash ?? sha256Json({
    total: page.total,
    rangeTotal: page.rangeTotal,
    transferIds: rows.map((transfer) => transfer.transferId).sort()
  });
}

function newestDate(rows: IndexedTronUsdtTransfer[]): Date | null {
  return rows.reduce<Date | null>((newest, row) => {
    if (!newest || row.blockTimestamp > newest) return row.blockTimestamp;
    return newest;
  }, null);
}

function oldestDate(rows: IndexedTronUsdtTransfer[]): Date | null {
  return rows.reduce<Date | null>((oldest, row) => {
    if (!oldest || row.blockTimestamp < oldest) return row.blockTimestamp;
    return oldest;
  }, null);
}

function mergeProvider(left: TronAddressUsdtIndexProvider | null, right: TronAddressUsdtIndexProvider | null): TronAddressUsdtIndexProvider | null {
  if (!left) return right;
  if (!right || left === right) return left;
  return "mixed";
}

function mergeNewest(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function mergeOldest(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function partialResult(
  reason: TronAddressUsdtCoverageStatusReason,
  overrides: Partial<WindowResult> = {}
): WindowResult {
  return {
    status: "partial",
    reason,
    pagesFetched: 0,
    rowsFetched: 0,
    uniqueRowsInserted: 0,
    provider: null,
    totalReported: null,
    providerCapHit: reason === "partial_provider_cap",
    budgetExhausted: reason === "partial_budget_exhausted",
    providerInconsistent: reason === "partial_provider_inconsistent",
    newestTransferAt: null,
    oldestTransferAt: null,
    partialRows: [],
    ...overrides
  };
}

function completeResult(input: Omit<WindowResult, "status" | "reason" | "providerCapHit" | "budgetExhausted" | "providerInconsistent" | "partialRows">): WindowResult {
  return {
    status: "complete",
    reason: "complete_provider_windowed",
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    partialRows: [],
    ...input
  };
}

function dedupeTransfers(transfers: IndexedTronUsdtTransfer[]): IndexedTronUsdtTransfer[] {
  return [...new Map(transfers.map((transfer) => [transfer.transferId ?? "", transfer])).values()];
}

function mergeWindowResults(left: WindowResult, right: WindowResult): WindowResult {
  const merged = {
    pagesFetched: left.pagesFetched + right.pagesFetched,
    rowsFetched: left.rowsFetched + right.rowsFetched,
    uniqueRowsInserted: left.uniqueRowsInserted + right.uniqueRowsInserted,
    provider: mergeProvider(left.provider, right.provider),
    totalReported: right.totalReported ?? left.totalReported,
    providerCapHit: left.providerCapHit || right.providerCapHit,
    budgetExhausted: left.budgetExhausted || right.budgetExhausted,
    providerInconsistent: left.providerInconsistent || right.providerInconsistent,
    newestTransferAt: mergeNewest(left.newestTransferAt, right.newestTransferAt),
    oldestTransferAt: mergeOldest(left.oldestTransferAt, right.oldestTransferAt),
    partialRows: dedupeTransfers([...left.partialRows, ...right.partialRows])
  };
  if (left.status === "partial") return partialResult(left.reason, merged);
  if (right.status === "partial") return partialResult(right.reason, merged);
  return completeResult(merged);
}

function ordinalRowsByTx(
  transfers: RawTronscanTrc20Transfer[],
  provider: Exclude<TronAddressUsdtIndexProvider, "mixed">,
  startOffset: number
): IndexedTronUsdtTransfer[] {
  return transfers
    .flatMap((transfer, rawRowIndex) => {
      if (!shouldIndexCanonicalTronscanUsdtTransfer(transfer)) return [];
      // ponytail: provider offset + raw row index is stable inside the audited provider window; switch to provider log indexes if TronScan exposes them consistently.
      return [normalizeTronscanTransferForAddressIndex(transfer, provider, startOffset + rawRowIndex)];
    });
}

async function measureIndexerStage<T>(
  deps: IndexTronAddressUsdtHistoryDeps,
  stage: "apiMs" | "dbWriteMs",
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  const value = await fn();
  try {
    await deps.onBenchmarkStageTiming?.(stage, Math.max(0, Date.now() - started));
  } catch {
    // ponytail: benchmark telemetry is diagnostic; indexing success must not depend on progress writes.
  }
  return value;
}

async function fetchAndAuditPage(
  deps: IndexTronAddressUsdtHistoryDeps,
  window: TimeWindow,
  offset: number,
  targetTimestamp: Date | null
): Promise<AuditedPage> {
  const limit = pageLimit(deps);
  const result = await measureIndexerStage(deps, "apiMs", () =>
    deps.listTransferPage(deps.address, {
      start: offset,
      limit,
      startTimestamp: window.startMs,
      endTimestamp: window.endMs
    })
  );
  const rows = ordinalRowsByTx(result.transfers, result.provider, offset);
  const rawHash = result.rawResponseHash ?? sha256Json(result);
  const canonicalHash = canonicalTransferHash(result, rows);
  const previous = deps.initialPagesByKey?.get(pageKey(window.startMs, window.endMs, offset));
  const inconsistent = Boolean(previous?.canonicalTransferHash && previous.canonicalTransferHash !== canonicalHash);

  await measureIndexerStage(deps, "dbWriteMs", () =>
    deps.upsertPage({
      address: deps.address,
      coverageMode: deps.coverageMode,
      targetTimestampMs: targetTimestamp?.getTime() ?? 0,
      windowStartTimestampMs: window.startMs,
      windowEndTimestampMs: window.endMs,
      startOffset: offset,
      limitCount: limit,
      status: rows.length === 0 ? "empty" : "complete",
      transferCount: rows.length,
      provider: result.provider,
      totalReported: result.total,
      rangeTotal: result.rangeTotal,
      rawResponseHash: rawHash,
      canonicalTransferHash: canonicalHash,
      attemptCount: 1,
      error: null,
      newestTransferAt: newestDate(rows),
      oldestTransferAt: oldestDate(rows)
    })
  );

  return {
    provider: result.provider,
    total: result.total,
    rangeTotal: result.rangeTotal,
    rawRowsFetched: result.transfers.length,
    rows,
    rawResponseHash: rawHash,
    canonicalTransferHash: canonicalHash,
    inconsistent
  };
}

function buildOffsets(rangeTotal: number, limit: number): number[] {
  const offsets: number[] = [];
  for (let offset = limit; offset < rangeTotal; offset += limit) offsets.push(offset);
  return offsets;
}

async function fetchOffsetPages(
  deps: IndexTronAddressUsdtHistoryDeps,
  window: TimeWindow,
  offsets: number[],
  budget: { pagesLeft: number },
  targetTimestamp: Date | null
): Promise<{ pages: AuditedPage[]; budgetExhausted: boolean }> {
  const pages: AuditedPage[] = [];
  for (let index = 0; index < offsets.length; index += pageBatchSize(deps)) {
    if (budget.pagesLeft <= 0) return { pages, budgetExhausted: true };
    const batch = offsets.slice(index, index + Math.min(pageBatchSize(deps), budget.pagesLeft));
    budget.pagesLeft -= batch.length;
    pages.push(...await Promise.all(batch.map((offset) => fetchAndAuditPage(deps, window, offset, targetTimestamp))));
    if (batch.length < pageBatchSize(deps) && index + batch.length < offsets.length) {
      return { pages, budgetExhausted: true };
    }
  }
  return { pages, budgetExhausted: false };
}

async function completeWindow(
  deps: IndexTronAddressUsdtHistoryDeps,
  window: TimeWindow,
  targetTimestamp: Date | null,
  input: {
    transfers: IndexedTronUsdtTransfer[];
    pagesFetched: number;
    provider: TronAddressUsdtIndexProvider;
    totalReported: number | null;
    rangeTotal: number | null;
    capHit: boolean;
  }
): Promise<WindowResult> {
  const transfers = dedupeTransfers(input.transfers);
  await measureIndexerStage(deps, "dbWriteMs", () => deps.upsertTransfers(transfers));
  await measureIndexerStage(deps, "dbWriteMs", () =>
    deps.upsertCoverageInterval({
      address: deps.address,
      coverageMode: deps.coverageMode,
      targetTimestamp,
      provider: input.provider,
      startTimestamp: new Date(window.startMs),
      endTimestamp: new Date(window.endMs),
      status: "complete",
      statusReason: "complete_provider_windowed",
      totalReported: input.totalReported,
      rangeTotal: input.rangeTotal,
      pagesFetched: input.pagesFetched,
      rowsFetched: transfers.length,
      uniqueRowsInserted: transfers.length,
      capHit: input.capHit,
      providerInconsistent: false,
      completedAt: deps.now?.() ?? new Date()
    })
  );

  return completeResult({
    pagesFetched: input.pagesFetched,
    rowsFetched: transfers.length,
    uniqueRowsInserted: transfers.length,
    provider: input.provider,
    totalReported: input.totalReported,
    newestTransferAt: newestDate(transfers),
    oldestTransferAt: oldestDate(transfers)
  });
}

async function ensureWindow(
  deps: IndexTronAddressUsdtHistoryDeps,
  window: TimeWindow,
  budget: { pagesLeft: number },
  targetTimestamp: Date | null
): Promise<WindowResult> {
  if (budget.pagesLeft <= 0) return partialResult("partial_budget_exhausted");

  const first = await fetchAndAuditPage(deps, window, 0, targetTimestamp);
  budget.pagesLeft -= 1;
  if (first.inconsistent) {
    return partialResult("partial_provider_inconsistent", {
      pagesFetched: 1,
      rowsFetched: first.rows.length,
      provider: first.provider,
      totalReported: first.total,
      newestTransferAt: newestDate(first.rows),
      oldestTransferAt: oldestDate(first.rows)
    });
  }
  if (first.rangeTotal === null) {
    return partialResult("partial_provider_cap", {
      pagesFetched: 1,
      rowsFetched: first.rows.length,
      uniqueRowsInserted: first.rows.length,
      provider: first.provider,
      totalReported: first.total,
      newestTransferAt: newestDate(first.rows),
      oldestTransferAt: oldestDate(first.rows),
      partialRows: first.rows
    });
  }

  if (first.rangeTotal >= PROVIDER_CAP_RANGE_TOTAL && first.rawRowsFetched < pageLimit(deps)) {
    return completeWindow(deps, window, targetTimestamp, {
      transfers: first.rows,
      pagesFetched: 1,
      provider: first.provider,
      totalReported: first.total,
      rangeTotal: first.rangeTotal,
      capHit: true
    });
  }

  if (first.rangeTotal >= PROVIDER_CAP_RANGE_TOTAL) {
    if (window.depth >= (deps.maxWindowSplitDepth ?? DEFAULT_MAX_WINDOW_SPLIT_DEPTH)) {
      return partialResult("partial_provider_cap", {
        pagesFetched: 1,
        rowsFetched: first.rows.length,
        uniqueRowsInserted: first.rows.length,
        provider: first.provider,
        totalReported: first.total,
        newestTransferAt: newestDate(first.rows),
        oldestTransferAt: oldestDate(first.rows),
        partialRows: first.rows
      });
    }
    if (window.endMs <= window.startMs + 1) {
      return partialResult("partial_provider_cap", {
        pagesFetched: 1,
        rowsFetched: first.rows.length,
        uniqueRowsInserted: first.rows.length,
        provider: first.provider,
        totalReported: first.total,
        newestTransferAt: newestDate(first.rows),
        oldestTransferAt: oldestDate(first.rows),
        partialRows: first.rows
      });
    }

    const midMs = Math.floor((window.startMs + window.endMs) / 2);
    const newer = await ensureWindow(deps, { startMs: midMs, endMs: window.endMs, depth: window.depth + 1 }, budget, targetTimestamp);
    const older = await ensureWindow(deps, { startMs: window.startMs, endMs: midMs, depth: window.depth + 1 }, budget, targetTimestamp);
    const merged = mergeWindowResults(newer, older);
    const parentRowsForPartial = merged.status === "partial" && merged.pagesFetched === 0 ? first.rows : [];
    return {
      ...merged,
      pagesFetched: merged.pagesFetched + 1,
      rowsFetched: merged.rowsFetched + parentRowsForPartial.length,
      uniqueRowsInserted: merged.uniqueRowsInserted + parentRowsForPartial.length,
      provider: mergeProvider(first.provider, merged.provider),
      totalReported: first.total ?? merged.totalReported,
      providerCapHit: true,
      partialRows: merged.status === "partial"
        ? dedupeTransfers([...parentRowsForPartial, ...merged.partialRows])
        : []
    };
  }

  const deduped = new Map(first.rows.map((transfer) => [transfer.transferId ?? "", transfer]));
  let rawRowsFetched = first.rawRowsFetched;
  const offsets = buildOffsets(first.rangeTotal, pageLimit(deps));
  const offsetResult = await fetchOffsetPages(deps, window, offsets, budget, targetTimestamp);
  let pagesFetched = 1 + offsetResult.pages.length;
  let provider = first.provider as TronAddressUsdtIndexProvider;
  let newestTransferAt = newestDate(first.rows);
  let oldestTransferAt = oldestDate(first.rows);

  for (const page of offsetResult.pages) {
    if (page.inconsistent) {
      return partialResult("partial_provider_inconsistent", {
        pagesFetched,
        rowsFetched: deduped.size,
        provider,
        totalReported: first.total,
        newestTransferAt,
        oldestTransferAt
      });
    }
    provider = mergeProvider(provider, page.provider) ?? provider;
    rawRowsFetched += page.rawRowsFetched;
    newestTransferAt = mergeNewest(newestTransferAt, newestDate(page.rows));
    oldestTransferAt = mergeOldest(oldestTransferAt, oldestDate(page.rows));
    for (const transfer of page.rows) deduped.set(transfer.transferId ?? "", transfer);
  }

  if (offsetResult.budgetExhausted || rawRowsFetched < first.rangeTotal) {
    const transfers = [...deduped.values()];
    return partialResult("partial_budget_exhausted", {
      pagesFetched,
      rowsFetched: transfers.length,
      uniqueRowsInserted: transfers.length,
      provider,
      totalReported: first.total,
      newestTransferAt,
      oldestTransferAt,
      partialRows: transfers
    });
  }

  const transfers = [...deduped.values()];
  return completeWindow(deps, window, targetTimestamp, {
    transfers,
    pagesFetched,
    provider,
    totalReported: first.total,
    rangeTotal: first.rangeTotal,
    capHit: false
  });
}

export async function indexTronAddressUsdtHistory(deps: IndexTronAddressUsdtHistoryDeps): Promise<TronAddressUsdtIndexState> {
  const now = deps.now?.() ?? new Date();
  const targetTimestamp = deps.coverageMode === "targeted"
    ? deps.targetTimestamp ?? deps.stopAtTimestamp ?? null
    : null;
  const endMs = targetTimestamp?.getTime() ?? now.getTime();
  const budget = { pagesLeft: Math.max(0, Math.floor(deps.maxPagesPerRun ?? DEFAULT_MAX_PAGES_PER_RUN)) };

  await measureIndexerStage(deps, "dbWriteMs", () => deps.upsertState({
    address: deps.address,
    coverageMode: deps.coverageMode,
    targetTimestamp,
    status: "running",
    statusReason: null,
    requestedByJobId: deps.requestedByJobId ?? deps.initialState?.requestedByJobId ?? null,
    queuedReason: deps.queuedReason ?? deps.initialState?.queuedReason ?? (deps.coverageMode === "targeted" ? "targeted" : "all_time")
  }));

  const result = await ensureWindow(deps, { startMs: GENESIS_WINDOW_START_MS, endMs, depth: 0 }, budget, targetTimestamp);
  const partialRows = result.status === "partial" && !result.providerInconsistent
    ? dedupeTransfers(result.partialRows)
    : [];
  if (partialRows.length > 0) await measureIndexerStage(deps, "dbWriteMs", () => deps.upsertTransfers(partialRows));
  const uniqueCounterpartyCount = deps.countIndexedCounterparties
    ? await deps.countIndexedCounterparties(deps.address)
    : undefined;
  const commonState = {
    address: deps.address,
    coverageMode: deps.coverageMode,
    targetTimestamp,
    provider: result.provider,
    totalReported: result.totalReported,
    fetchedPageCount: result.pagesFetched,
    fetchedTransferCount: result.rowsFetched,
    uniqueCounterpartyCount,
    newestTransferAt: result.newestTransferAt,
    oldestTransferAt: result.oldestTransferAt,
    providerCapHit: result.providerCapHit,
    budgetExhausted: result.budgetExhausted,
    providerInconsistent: result.providerInconsistent,
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    requestedByJobId: deps.requestedByJobId ?? deps.initialState?.requestedByJobId ?? null,
    queuedReason: deps.queuedReason ?? deps.initialState?.queuedReason ?? (deps.coverageMode === "targeted" ? "targeted" : "all_time")
  };

  if (result.status === "partial") {
    return measureIndexerStage(deps, "dbWriteMs", () => deps.upsertState({
      ...commonState,
      status: "partial",
      statusReason: result.reason
    }));
  }

  return measureIndexerStage(deps, "dbWriteMs", () => deps.upsertState({
    ...commonState,
    status: "complete",
    statusReason: "complete_provider_windowed",
    coveredUntilTimestamp: new Date(GENESIS_WINDOW_START_MS),
    completedAt: now
  }));
}
