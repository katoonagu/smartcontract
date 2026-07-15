import type { WaitReconciliationResultV1 } from "../types";

export type WaitReconciliationCounts = Pick<
  WaitReconciliationResultV1,
  "parentJobId" | "readyCount" | "terminalCount" | "cancelledCount" | "waitingCount"
>;

const MAX_PARENT_JOB_ID_LENGTH = 512;

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function result(
  input: WaitReconciliationCounts,
  outcome: WaitReconciliationResultV1["outcome"],
  diagnosticCode: WaitReconciliationResultV1["diagnosticCode"]
): WaitReconciliationResultV1 {
  return {
    parentJobId: input.parentJobId,
    readyCount: input.readyCount,
    terminalCount: input.terminalCount,
    cancelledCount: input.cancelledCount,
    waitingCount: input.waitingCount,
    outcome,
    diagnosticCode
  };
}

function assertCounts(input: WaitReconciliationCounts): void {
  if (!isBoundedNonEmptyString(input.parentJobId, MAX_PARENT_JOB_ID_LENGTH)) {
    throw new RangeError("parentJobId must be a non-empty bounded string");
  }
  for (const key of ["readyCount", "terminalCount", "cancelledCount", "waitingCount"] as const) {
    if (!isCount(input[key])) throw new RangeError(`${key} must be a non-negative safe integer`);
  }
}

export function decideWaitReconciliation(
  input: WaitReconciliationCounts
): WaitReconciliationResultV1 {
  assertCounts(input);
  const total = input.readyCount + input.terminalCount + input.cancelledCount + input.waitingCount;
  if (!Number.isSafeInteger(total)) throw new RangeError("wait count total exceeds safe integer range");

  if (input.waitingCount > 0) {
    return result(input, "unchanged", null);
  }
  if (total === 0) {
    return result(input, "contradictory", "missing_wait_rows");
  }
  if (input.cancelledCount > 0) {
    return result(input, "contradictory", "cancelled_wait_present");
  }
  if (input.terminalCount > 0) {
    return result(input, "resume_terminal", null);
  }
  return result(input, "resume_ready", null);
}

export function isWaitReconciliationResultV1(
  value: unknown
): value is WaitReconciliationResultV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.length !== 7
    || !keys.every((key) => typeof key === "string" && [
      "parentJobId",
      "readyCount",
      "terminalCount",
      "cancelledCount",
      "waitingCount",
      "outcome",
      "diagnosticCode"
    ].includes(key))
    || !isBoundedNonEmptyString(record.parentJobId, MAX_PARENT_JOB_ID_LENGTH)
    || !isCount(record.readyCount)
    || !isCount(record.terminalCount)
    || !isCount(record.cancelledCount)
    || !isCount(record.waitingCount)) {
    return false;
  }

  try {
    const expected = decideWaitReconciliation({
      parentJobId: record.parentJobId,
      readyCount: record.readyCount,
      terminalCount: record.terminalCount,
      cancelledCount: record.cancelledCount,
      waitingCount: record.waitingCount
    });
    return record.outcome === expected.outcome && record.diagnosticCode === expected.diagnosticCode;
  } catch {
    return false;
  }
}
