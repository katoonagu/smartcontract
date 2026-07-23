import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { canonicalJson, canonicalSha256 } from "../../tools/golden-pilot-v2/canonicalJson";
import { buildNeutralExport } from "../../tools/golden-pilot-v2/neutralExport";
import {
  buildPureGoldenCapture,
  publishCanonicalArtifactIdentically
} from "../../tools/golden-capture-v2/capture";

const CATALOG = JSON.parse(
  await readFile(
    new URL(
      "../../docs/audit/2026-07-system-audit/golden-v2/case-catalog.json",
      import.meta.url
    ),
    "utf8"
  )
);
const SYNTHETIC = JSON.parse(
  await readFile(
    new URL("../fixtures/golden-v2/synthetic-cases.json", import.meta.url),
    "utf8"
  )
);

const addresses = [
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKLxmGkn",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKT76qbH",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKawPyGg",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKi6mJHp",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKsN8FyA",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKv2TRTS",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkL2ynyg7"
];

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

function input(selectionRows: Array<Record<string, unknown>>) {
  const evidenceBySubject = Object.fromEntries(
    [
      ...addresses,
      "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
      "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP"
    ].map((address) => [
      address,
      { events: [], stateFacts: [], labels: [], approvals: [] }
    ])
  );
  return {
    catalog: CATALOG,
    syntheticCases: SYNTHETIC,
    selectionRows,
    selectionCutoff: "2026-07-23T00:01:00.000Z",
    snapshot: {
      confirmedBlockNumber: "999",
      confirmedBlockHash: "b".repeat(64),
      timestamp: "2026-07-23T00:00:30.000Z"
    },
    providerResponseSha256: "c".repeat(64),
    labelDatasetSha256: "d".repeat(64),
    coverageCertificateSha256: "f".repeat(64),
    evidenceBySubject
  };
}

describe("pure golden capture coordinator", () => {
  test("selects five blind subjects deterministically and emits 24 prevalidated sources", () => {
    const rows = [
      {
        jobId: "job-a-old",
        subjectAddress: addresses[0],
        createdAt: "2026-07-23T00:00:01.000Z",
        chatId: "chat",
        score: 99,
        narrative: "must never escape"
      },
      ...addresses.slice(0, 6).map((subjectAddress, index) => ({
        jobId: `job-${index}`,
        subjectAddress,
        createdAt: `2026-07-23T00:00:${(20 - index)
          .toString()
          .padStart(2, "0")}.000Z`,
        requestedBy: "user",
        resultJson: { score: index, decision: "DECLINE" },
        progressJson: { narrative: "secret system output" }
      })),
      {
        jobId: "system-only",
        subjectAddress: addresses[6],
        createdAt: "2026-07-23T00:00:59.000Z",
        chatId: null,
        requestedBy: null
      },
      {
        jobId: "regression",
        subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
        createdAt: "2026-07-23T00:00:58.000Z",
        chatId: "chat"
      }
    ];

    const capture = buildPureGoldenCapture(input(rows));
    const reordered = buildPureGoldenCapture(input([...rows].reverse()));

    expect(canonicalJson(capture)).toBe(canonicalJson(reordered));
    expect(capture.selectionManifest.selectedSubjects).toEqual(addresses.slice(0, 5));
    expect(capture.sources).toHaveLength(24);
    expect(new Set(capture.sources.map(({ caseId }) => caseId)).size).toBe(24);

    const blindSubjects = capture.catalog.cases
      .filter(({ group }) => group === "blind_review")
      .map(({ subjectAddress }) => subjectAddress);
    expect(blindSubjects).toEqual(addresses.slice(0, 5));
    expect(
      capture.catalog.cases.find(({ caseId }) => caseId === "regression-tbl7")
        ?.subjectAddress
    ).toBe("TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy");
    expect(
      capture.catalog.cases.find(({ caseId }) => caseId === "regression-tqr")
        ?.subjectAddress
    ).toBe("TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP");

    for (const source of capture.sources) {
      expect(() => buildNeutralExport(source)).not.toThrow();
      expect(canonicalJson(source)).not.toMatch(
        /"(score|riskLevel|decision|narrative|resultJson|progressJson)"/i
      );
    }

    expect(capture.captureManifest.snapshot).toEqual(input(rows).snapshot);
    expect(capture.captureManifest.providerResponseSha256).toBe("c".repeat(64));
    expect(capture.captureManifest.labelDatasetSha256).toBe("d".repeat(64));
    expect(capture.captureManifest.selectionSha256).toBe(
      capture.selectionManifest.selectionSha256
    );
    expect(capture.captureManifest.sourceInventory).toHaveLength(24);
    expect(capture.captureManifest.sourceInventory.every(
      ({ validatorReceiptSha256 }) => /^[0-9a-f]{64}$/.test(validatorReceiptSha256)
    )).toBe(true);
    expect(canonicalJson(capture)).not.toContain("secret system output");
    expect(canonicalJson(capture)).not.toContain("must never escape");
  });

  test("fails technically unless exactly five eligible subjects exist", () => {
    expect(() =>
      buildPureGoldenCapture(
        input(
          addresses.slice(0, 4).map((subjectAddress, index) => ({
            jobId: `job-${index}`,
            subjectAddress,
            createdAt: `2026-07-23T00:00:0${index}.000Z`,
            chatId: "chat"
          }))
        )
      )
    ).toThrow("FAILED_TECHNICAL:golden_capture_requires_five_blind_subjects");
  });

  test("rejects a shape-valid catalog that changes the locked case set", () => {
    const rows = addresses.slice(0, 5).map((subjectAddress, index) => ({
      jobId: `job-${index}`,
      subjectAddress,
      createdAt: `2026-07-23T00:00:0${index}.000Z`,
      requestedBy: "user"
    }));
    const base = input(rows);
    const catalog = structuredClone(base.catalog);
    catalog.groups[0].caseIds[0] = "blind-replacement";
    catalog.cases[0].caseId = "blind-replacement";
    expect(() =>
      buildPureGoldenCapture({ ...base, catalog })
    ).toThrow("FAILED_TECHNICAL:golden_capture_locked_case_set_mismatch");

    const subjectMismatch = structuredClone(base.catalog);
    subjectMismatch.cases.find(
      ({ caseId }: { caseId: string }) => caseId === "synthetic-empty-wallet"
    )!.subjectAddress = addresses[6];
    expect(() =>
      buildPureGoldenCapture({ ...base, catalog: subjectMismatch })
    ).toThrow("FAILED_TECHNICAL:golden_capture_synthetic_subject_mismatch");
  });

  test("rejects system requesters, compares parsed timestamps and binds real evidence plus provenance", () => {
    const rows = addresses.slice(0, 5).map((subjectAddress, index) => ({
      jobId: `job-${index}`,
      subjectAddress,
      createdAt:
        index === 0
          ? "2026-07-23T00:00:20.000Z"
          : `2026-07-23T00:00:${(19 - index).toString().padStart(2, "0")}.000Z`,
      requestedBy: "user"
    }));
    rows.push({
      jobId: "system",
      subjectAddress: addresses[5],
      createdAt: "2026-07-23T00:00:29.000Z",
      requestedBy: "admin_strict_benchmark"
    });
    const evidence = {
      events: [
        {
          txHash: "e".repeat(64),
          eventIndex: "0",
          tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          from: addresses[5],
          to: addresses[0],
          amountRaw: "1000000",
          timestamp: "2026-07-23T00:00:10.000Z",
          blockNumber: "100",
          factType: "trc20_transfer"
        }
      ],
      stateFacts: [],
      labels: [],
      approvals: []
    };

    const base = input(rows);
    const capture = buildPureGoldenCapture({
      ...base,
      evidenceBySubject: {
        ...base.evidenceBySubject,
        [addresses[0]]: evidence
      }
    });
    expect(capture.selectionManifest.selectedSubjects).toEqual(addresses.slice(0, 5));
    expect(capture.sources[0].events).toEqual(evidence.events);
    expect(capture.sources[0].captureProvenance.providerResponseSha256).toBe(
      "c".repeat(64)
    );
    expect(() =>
      buildPureGoldenCapture({
        ...input(rows),
        providerResponseSha256: "not-a-hash"
      })
    ).toThrow("FAILED_TECHNICAL:golden_capture_invalid_provenance_hash");
  });

  test("constructs quantitative blacklist and performance fixtures", () => {
    const capture = buildPureGoldenCapture(
      input(
        addresses.slice(0, 5).map((subjectAddress, index) => ({
          jobId: `job-${index}`,
          subjectAddress,
          createdAt: `2026-07-23T00:00:0${index}.000Z`,
          chatId: "chat",
          requestedBy: "user"
        }))
      )
    );
    const byCase = new Map(capture.sources.map((source) => [source.caseId, source]));
    const blacklist = byCase.get("synthetic-direct-blacklist-1pct")!;
    const total = blacklist.events.reduce(
      (sum, item) => sum + BigInt(item.amountRaw),
      0n
    );
    expect(blacklist.events.find(({ from }) => from === addresses[6])?.amountRaw).toBe(
      (total / 100n).toString()
    );
    expect(byCase.get("synthetic-dense-wallet")!.events.length).toBeGreaterThan(50);
    expect(
      byCase
        .get("synthetic-500-pages")!
        .stateFacts.filter(({ factType }) => factType === "direct_history_page")
    ).toHaveLength(500);
    expect(byCase.get("synthetic-reorder")!.events).toHaveLength(3);
    const duplicateFacts = byCase.get("synthetic-duplicates")!.stateFacts;
    expect(duplicateFacts).toHaveLength(2);
    expect(duplicateFacts[1]).toEqual(duplicateFacts[0]);
    const restartFacts = byCase.get("synthetic-restart")!.stateFacts;
    expect(restartFacts).toHaveLength(2);
    expect(restartFacts[1]).toEqual(restartFacts[0]);
    expect(byCase.get("synthetic-key-exhaustion")!.stateFacts).toHaveLength(4);
    expect(
      byCase
        .get("synthetic-ambiguous-delivery")!
        .stateFacts.map(({ factType }) => factType)
    ).toEqual(["delivery_unknown", "automatic_retry_forbidden"]);
  });

  test("publishes identical canonical bytes idempotently and rejects changed content", async () => {
    const root = await mkdtemp(join(tmpdir(), "golden-capture-v2-"));
    temporaryRoots.push(root);

    const first = await publishCanonicalArtifactIdentically(root, "capture/test.json", {
      z: 2,
      a: 1
    });
    const second = await publishCanonicalArtifactIdentically(root, "capture/test.json", {
      a: 1,
      z: 2
    });

    expect(second).toEqual(first);
    expect(first.sha256).toBe(canonicalSha256({ a: 1, z: 2 }));
    await expect(
      Promise.all(
        Array.from({ length: 4 }, () =>
          publishCanonicalArtifactIdentically(root, "capture/concurrent.json", {
            stable: true
          })
        )
      )
    ).resolves.toHaveLength(4);
    await expect(
      publishCanonicalArtifactIdentically(root, "capture/test.json", { a: 2 })
    ).rejects.toThrow("golden_artifact_existing_content_differs");
  });
});
