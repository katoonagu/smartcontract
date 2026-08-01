import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNeutralExport,
  publishNeutralExport
} from "../../tools/golden-pilot-v2/neutralExport";
import {
  canonicalJson,
  canonicalSha256
} from "../../tools/golden-pilot-v2/canonicalJson";
import { validFrozenSource } from "../fixtures/golden-v2/builders";

describe("Golden V2 neutral evidence export", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true })
      )
    );
  });

  it("fails closed when a forbidden field is nested in the source", () => {
    const source = validFrozenSource({
      caseId: "regression-tbl7",
      extra: { nested: { riskScore: 31 } }
    });
    expect(() => buildNeutralExport(source)).toThrow(
      "golden_forbidden_field:riskScore"
    );
  });

  it("emits a neutral bundle, provenance manifest and no-leak receipt", () => {
    const result = buildNeutralExport(validFrozenSource());

    expect(result.bundle.version).toBe("neutral-evidence-bundle-v2");
    expect(result.manifest.sourceSnapshot.blockHash).toMatch(
      /^[0-9a-f]{64}$/u
    );
    expect(result.receipt.forbiddenFieldMatches).toEqual([]);
    expect(result.receipt.systemNarrativePresent).toBe(false);
    expect(result.receipt.systemScorePresent).toBe(false);
    expect(result.receipt.fieldInventorySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.manifest.contentSha256).toBe(
      canonicalSha256(result.bundle)
    );
    expect(result.manifest.rawEvidenceInventory.map((item) => item.kind)).toEqual(
      ["approvals", "events", "labels", "stateFacts"]
    );
  });

  it("canonicalizes object and event order without hiding duplicates", () => {
    const source = validFrozenSource();
    const reorderedObjects = JSON.parse(canonicalJson(source)) as typeof source;
    const reorderedEvents = {
      ...source,
      events: [...source.events].reverse()
    };
    const baseline = buildNeutralExport(source);

    expect(buildNeutralExport(reorderedObjects)).toEqual(baseline);
    expect(buildNeutralExport(reorderedEvents)).toEqual(baseline);
    expect(() =>
      buildNeutralExport({
        ...source,
        events: [
          ...source.events,
          { ...source.events[0]!, amountRaw: "999999" }
        ]
      })
    ).toThrow("golden_duplicate_event_identity");
  });

  it("binds manifest hashes to the snapshot and label dataset", () => {
    const source = validFrozenSource();
    const baseline = buildNeutralExport(source);
    const changedBlock = buildNeutralExport({
      ...source,
      snapshot: {
        ...source.snapshot,
        confirmedBlockHash: "e".repeat(64)
      }
    });
    const changedLabels = buildNeutralExport({
      ...source,
      snapshot: {
        ...source.snapshot,
        labelDatasetSha256: "d".repeat(64)
      }
    });

    expect(canonicalSha256(changedBlock.manifest)).not.toBe(
      canonicalSha256(baseline.manifest)
    );
    expect(canonicalSha256(changedLabels.manifest)).not.toBe(
      canonicalSha256(baseline.manifest)
    );
  });

  it("rejects evidence after the snapshot and output path escapes", async () => {
    const source = validFrozenSource();
    expect(() =>
      buildNeutralExport({
        ...source,
        events: [
          {
            ...source.events[0]!,
            timestamp: "2026-07-23T00:00:01.000Z"
          }
        ]
      })
    ).toThrow("golden_evidence_after_snapshot");

    const root = await mkdtemp(join(tmpdir(), "golden-neutral-"));
    temporaryRoots.push(root);
    await expect(
      publishNeutralExport(root, "../escape.json", source)
    ).rejects.toThrow("golden_artifact_path_invalid");
  });

  it("rejects production markers but not ordinary evidence language", () => {
    expect(() =>
      buildNeutralExport(
        validFrozenSource({ extra: { note: "score-anchor-v2" } })
      )
    ).toThrow("golden_forbidden_value:score-anchor-v");
    expect(() =>
      buildNeutralExport(
        validFrozenSource({
          extra: { note: "A source described operational risk." }
        })
      )
    ).not.toThrow();
  });
});
