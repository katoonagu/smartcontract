import { describe, expect, it } from "vitest";
import {
  canonicalOrderedTasks,
  selectBoundedReadyPrefix,
  type UnifiedOrderedTaskIdentity,
  type UnifiedPlannerPrefixEntry
} from "../../src/unifiedCheck/planner";

const task = (
  taskId: string,
  kind: string,
  logicalKey: string
): UnifiedOrderedTaskIdentity => ({ taskId, kind, logicalKey });

const entry = (
  canonicalSequence: number,
  plannerState: UnifiedPlannerPrefixEntry["plannerState"],
  resultBytes: number | null
): UnifiedPlannerPrefixEntry => ({ canonicalSequence, plannerState, resultBytes });

describe("Unified planner", () => {
  it("orders kind and logical key independently of random task IDs and input permutation", () => {
    const first = canonicalOrderedTasks([
      task("random-z", "traversal", "wallet-b"),
      task("random-a", "direct", "wallet-a"),
      task("random-q", "traversal", "wallet-a")
    ]);
    const second = canonicalOrderedTasks([
      task("different-q", "traversal", "wallet-a"),
      task("different-z", "traversal", "wallet-b"),
      task("different-a", "direct", "wallet-a")
    ]);

    expect(first.map(({ kind, logicalKey }) => [kind, logicalKey])).toEqual([
      ["direct", "wallet-a"],
      ["traversal", "wallet-a"],
      ["traversal", "wallet-b"]
    ]);
    expect(second.map(({ kind, logicalKey }) => [kind, logicalKey])).toEqual(
      first.map(({ kind, logicalKey }) => [kind, logicalKey])
    );
  });

  it("uses deterministic UTF-16 code-unit ordering for non-ASCII identities", () => {
    const ordered = canonicalOrderedTasks([
      task("three", "kind", "\u044f"),
      task("one", "kind", "\u00e4"),
      task("two", "kind", "z"),
      task("four", "kind", "\ud83d\ude00")
    ]);

    expect(ordered.map((value) => value.logicalKey)).toEqual([
      "z",
      "\u00e4",
      "\u044f",
      "\ud83d\ude00"
    ]);
  });

  it("collapses exact duplicate tasks and rejects conflicting canonical identities", () => {
    const duplicate = task("task-1", "direct", "wallet-a");
    expect(canonicalOrderedTasks([duplicate, { ...duplicate }])).toEqual([duplicate]);
    expect(() => canonicalOrderedTasks([
      task("task-1", "direct", "wallet-a"),
      task("task-2", "direct", "wallet-a")
    ])).toThrow("unified_planner_task_identity_conflict");
  });

  it("rejects blank task identity fields", () => {
    expect(() => canonicalOrderedTasks([task("  ", "kind", "key")])).toThrow(
      "unified_planner_task_id_invalid"
    );
    expect(() => canonicalOrderedTasks([task("task", "\t", "key")])).toThrow(
      "unified_planner_kind_invalid"
    );
    expect(() => canonicalOrderedTasks([task("task", "kind", "\n")])).toThrow(
      "unified_planner_logical_key_invalid"
    );
  });

  it("takes only the continuous ready prefix without skipping blocked or gapped entries", () => {
    const planned = [entry(10, "ready", 2), entry(11, "planned", 2), entry(12, "ready", 2)];
    const gapped = [entry(10, "ready", 2), entry(12, "ready", 2)];
    const missingBytes = [entry(10, "ready", 2), entry(11, "ready", null), entry(12, "ready", 2)];

    expect(selectBoundedReadyPrefix(planned, { maxEntries: 3, maxBytes: 10 })).toEqual([planned[0]]);
    expect(selectBoundedReadyPrefix(gapped, { maxEntries: 3, maxBytes: 10 })).toEqual([gapped[0]]);
    expect(selectBoundedReadyPrefix(missingBytes, { maxEntries: 3, maxBytes: 10 })).toEqual([missingBytes[0]]);
  });

  it("honors entry and inclusive byte limits", () => {
    const entries = [entry(0, "ready", 2), entry(1, "ready", 3), entry(2, "ready", 1)];

    expect(selectBoundedReadyPrefix(entries, { maxEntries: 2, maxBytes: 10 })).toEqual(entries.slice(0, 2));
    expect(selectBoundedReadyPrefix(entries, { maxEntries: 2, maxBytes: 10 })[0]).toBe(entries[0]);
    expect(selectBoundedReadyPrefix(entries, { maxEntries: 3, maxBytes: 5 })).toEqual(entries.slice(0, 2));
    expect(selectBoundedReadyPrefix(entries, { maxEntries: 3, maxBytes: 4 })).toEqual([entries[0]]);
  });

  it("permits zero-byte results and an empty input", () => {
    const entries = [entry(4, "ready", 0), entry(5, "ready", 1)];

    expect(selectBoundedReadyPrefix(entries, { maxEntries: 2, maxBytes: 1 })).toEqual(entries);
    expect(selectBoundedReadyPrefix([], { maxEntries: 1, maxBytes: 1 })).toEqual([]);
  });

  it("rejects invalid limits, sequences, and result byte values", () => {
    const valid = [entry(0, "ready", 1)];

    expect(() => selectBoundedReadyPrefix(valid, { maxEntries: 0, maxBytes: 1 })).toThrow(
      "unified_planner_commit_entries_invalid"
    );
    expect(() => selectBoundedReadyPrefix(valid, { maxEntries: 1, maxBytes: Number.POSITIVE_INFINITY })).toThrow(
      "unified_planner_commit_bytes_invalid"
    );
    expect(() => selectBoundedReadyPrefix([entry(-1, "ready", 1)], { maxEntries: 1, maxBytes: 1 })).toThrow(
      "unified_planner_sequence_invalid"
    );
    expect(() => selectBoundedReadyPrefix([entry(0, "ready", -1)], { maxEntries: 1, maxBytes: 1 })).toThrow(
      "unified_planner_result_bytes_invalid"
    );
    expect(() => selectBoundedReadyPrefix([entry(0, "ready", Number.MAX_SAFE_INTEGER + 1)], { maxEntries: 1, maxBytes: 1 })).toThrow(
      "unified_planner_result_bytes_invalid"
    );
  });
});
