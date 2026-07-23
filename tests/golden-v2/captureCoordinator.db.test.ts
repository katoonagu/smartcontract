import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  captureGoldenPilotV2,
  publishGoldenCaptureV2
} from "../../tools/golden-capture-v2/coordinator";

const catalog = JSON.parse(
  await readFile(
    new URL(
      "../../docs/audit/2026-07-system-audit/golden-v2/case-catalog.json",
      import.meta.url
    ),
    "utf8"
  )
);
const syntheticCases = JSON.parse(
  await readFile(
    new URL("../fixtures/golden-v2/synthetic-cases.json", import.meta.url),
    "utf8"
  )
);
const subjects = [
  "TYXN5ZiJLuzUyAY2dxdzdNjbwnUkSGB1it",
  "TV6bBsrCXz2sDSBMZhvc7vHqDwjc65ALZX",
  "TSv32fr41xwv3dh99PmtdxkhWguMEEuoVh",
  "TRddZMs7MJmbpQFuBpFxK4BDt5tA4LLPDu",
  "TEognYE7Sy6jiKxkDt2EbFgkUYUfsp9U2j"
];
const peer = "T9yD14Nj9j7xAB4dbGeiX9h8unkKv2TRTS";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("read-only golden capture coordinator", () => {
  test("uses a read-only transaction and captures only neutral direct evidence", async () => {
    const statements: Array<{ text: string; values: readonly unknown[] }> = [];
    const db = {
      async query(text: string, values: readonly unknown[] = []) {
        statements.push({ text, values });
        if (text === "SHOW transaction_read_only") {
          return { rows: [{ transaction_read_only: "on" }] };
        }
        if (text.includes("FROM forensic_check_jobs")) {
          return {
            rows: subjects.map((subjectAddress, index) => ({
              jobId: `job-${index}`,
              subjectAddress,
              createdAt: `2026-07-23T00:00:0${index}.000Z`,
              chatId: "chat",
              requestedBy: "7320458296"
            }))
          };
        }
        if (text.includes("FROM tron_usdt_transfers")) {
          return {
            rows: [
              {
                txHash: "1".repeat(64),
                blockNumber: "90",
                timestamp: "2026-07-23T00:00:08.000Z",
                eventIndex: "0",
                from: peer,
                to: subjects[0],
                amountRaw: "1000000"
              }
            ]
          };
        }
        if (text.includes("FROM tron_usdt_approvals")) {
          return {
            rows: [
              {
                txHash: "2".repeat(64),
                timestamp: "2026-07-23T00:00:09.000Z",
                eventIndex: "0",
                owner: subjects[0],
                spender: peer,
                amountRaw: "42",
                isUnlimited: false
              }
            ]
          };
        }
        if (text.includes("FROM address_labels")) {
          return {
            rows: [
              {
                address: peer,
                label: "exchange",
                authority: "system",
                observedAt: "2026-07-01T00:00:00.000Z"
              }
            ]
          };
        }
        if (text.includes("FROM address_metadata")) {
          return {
            rows: [
              {
                address: peer,
                name: "Bybit",
                tag: "Exchange",
                observedAt: "2026-07-02T00:00:00.000Z"
              }
            ]
          };
        }
        return { rows: [] };
      }
    };

    const result = await captureGoldenPilotV2({
      db,
      getConfirmedSnapshot: async () => ({
        snapshot: {
          confirmedBlockNumber: "100",
          confirmedBlockHash: "a".repeat(64),
          timestamp: "2026-07-23T00:00:30.000Z"
        },
        rawResponse: { blockID: "a".repeat(64), source: "solidity" }
      }),
      catalog,
      syntheticCases,
      selectionCutoff: "2026-07-23T00:00:10.000Z"
    });

    expect(statements[0].text).toBe("BEGIN READ ONLY");
    expect(statements[1].text).toBe("SHOW transaction_read_only");
    expect(statements.at(-1)?.text).toBe("ROLLBACK");
    expect(statements.map(({ text }) => text).join("\n")).not.toMatch(
      /result_json|progress_json|score|narrative/i
    );
    const source = result.capture.sources.find(
      ({ subjectAddress, caseId }) =>
        subjectAddress === subjects[0] && caseId.startsWith("blind-")
    )!;
    expect(source.events).toHaveLength(1);
    expect(source.approvals).toHaveLength(1);
    expect(source.labels.map(({ label }) => label)).toEqual([
      "Bybit",
      "exchange",
      "Exchange"
    ]);
    expect(result.labelDataset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.provenanceManifest.provider.responseSha256).toMatch(
      /^[0-9a-f]{64}$/
    );

    const root = await mkdtemp(join(tmpdir(), "golden-capture-db-"));
    temporaryRoots.push(root);
    const first = await publishGoldenCaptureV2(root, result);
    const second = await publishGoldenCaptureV2(root, result);
    expect(second).toEqual(first);
    expect(await readdir(join(root, "source"))).toHaveLength(25);
    expect(await readdir(join(root, "capture"))).toEqual([
      "capture-manifest.json",
      "label-dataset-manifest.json",
      "label-dataset.json",
      "provenance-manifest.json",
      "selection-manifest.json"
    ]);
  });

  test("rolls back and fails technically when read-only mode is not active", async () => {
    const statements: string[] = [];
    await expect(
      captureGoldenPilotV2({
        db: {
          async query(text: string) {
            statements.push(text);
            return text === "SHOW transaction_read_only"
              ? { rows: [{ transaction_read_only: "off" }] }
              : { rows: [] };
          }
        },
        getConfirmedSnapshot: async () => ({
          snapshot: {
            confirmedBlockNumber: "100",
            confirmedBlockHash: "a".repeat(64),
            timestamp: "2026-07-23T00:00:30.000Z"
          },
          rawResponse: {}
        }),
        catalog,
        syntheticCases,
        selectionCutoff: "2026-07-23T00:00:10.000Z"
      })
    ).rejects.toThrow("FAILED_TECHNICAL:golden_capture_database_not_read_only");
    expect(statements.at(-1)).toBe("ROLLBACK");
  });
});
