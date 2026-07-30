import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";

import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import {
  transactionProviderEvidenceId,
  transactionProviderFinalityWitnessSha256,
  type TronTransactionProviderEvidenceV1
} from "../../src/storage/transactionEvidenceRepository.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import {
  materializeServiceRoleEventMapV1,
  type ServiceRolePoisoningDispositionV1,
  type ServiceRoleProviderRiskDispositionV1
} from "../../src/unifiedCheck/serviceRoleMapMaterialization.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import type { TraversalStateV1 } from "../../src/unifiedCheck/traversal.js";
import { TRON_USDT_CONTRACT_ADDRESS as USDT } from "../../src/parser/transactionParser.js";

const RUN_ID = "run-1";
const SNAPSHOT_HASH = "a".repeat(64);
const MANIFEST_HASH = "b".repeat(64);
const PROFILED = "TG2B2Jb7PXbyKzhJ61yGpyFxqbGBL2cZUH";
const SUBJECT = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const SENDER = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
const RECEIVER = "TMwjbNHpsVSjn93vtWtLnThHwhAJAnrWNq";
const FEE = "TFNX7TKYCm1kUYDECjkrogBwYZvt69XQNy";
const CONTROLLER = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
const OTHER_CONTROLLER = "TW2Py9fWGc1HVXhejufX1stuwQ9N42Y8RE";

const uintWord = (value: bigint) => value.toString(16).padStart(64, "0");
const addressWord = (address: string) => TronWeb.address.toHex(address).slice(2).padStart(64, "0");

function permitData(value: bigint, maxFee: bigint): string {
  const signature = "11".repeat(65);
  return [
    "6f21b898", addressWord(USDT), addressWord(SENDER), addressWord(RECEIVER),
    uintWord(value), uintWord(maxFee), uintWord(1_800_000_000n), uintWord(1n),
    uintWord(9n), uintWord(0x120n), uintWord(65n), signature.padEnd(192, "0")
  ].join("");
}

function txHash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function event(index: number, timestamp: number): IndexedTronUsdtTransfer {
  return {
    txHash: txHash(index + 1),
    blockNumber: 20_000 - index,
    blockTimestamp: new Date(timestamp * 1_000),
    eventIndex: 0,
    fromAddress: `TSender-${index}`,
    toAddress: PROFILED,
    amountRaw: "1000000",
    method: "transfer",
    eventType: "Transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    reverted: false,
    riskTransaction: false,
    confirmed: true
  };
}

function providerPayload(item: IndexedTronUsdtTransfer): Record<string, unknown> {
  return {
    hash: item.txHash,
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    contractData: { contract_address: OTHER_CONTROLLER, data: `a9059cbb${"0".repeat(128)}` }
  };
}

function transactionEvidence(
  item: IndexedTronUsdtTransfer,
  payload = providerPayload(item)
): { id: string; evidence: TronTransactionProviderEvidenceV1 } {
  const identity = {
    version: "tron-transaction-provider-evidence-v1" as const,
    chain: "tron" as const,
    txHash: item.txHash,
    provider: "tronscan" as const,
    endpoint: "transaction-info" as const,
    providerSchemaVersion: 1 as const
  };
  const status = "confirmed_success" as const;
  const evidence: TronTransactionProviderEvidenceV1 = {
    ...identity,
    fetchedAt: "2026-07-30T00:00:00.000Z",
    finality: {
      status,
      witnessKind: "tronscan_transaction_info",
      witnessSha256: transactionProviderFinalityWitnessSha256({
        identity, status, payload, movement: null
      }),
      movement: null
    },
    payloadSha256: fingerprintCanonicalArtifact(payload),
    payload
  };
  return { id: transactionProviderEvidenceId(identity), evidence };
}

function poisoning(
  canonicalEventId: string,
  disposition: ServiceRolePoisoningDispositionV1["disposition"] = "not_poisoning"
) {
  const artifact: ServiceRolePoisoningDispositionV1 = {
    schemaVersion: "service-role-poisoning-disposition-v1",
    policyVersion: "address-poisoning-v1",
    runId: RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: MANIFEST_HASH,
    canonicalEventId,
    coverage: "complete",
    disposition,
    reason: "complete_no_match",
    comparison: {
      windowStart: "2024-01-01T00:00:00.000Z",
      windowEnd: "2024-01-01T00:00:00.000Z",
      pageArtifactHashes: [],
      canonicalComparisonEventIds: [],
      comparisonInventorySha256: fingerprintCanonicalArtifact([]),
      orderAuthority: "strictly_earlier_timestamp"
    }
  };
  return { sha256: fingerprintCanonicalArtifact(artifact), artifact };
}

function providerRisk(
  canonicalEventId: string,
  disposition: ServiceRoleProviderRiskDispositionV1["disposition"] = "not_provider_risk"
) {
  const artifact: ServiceRoleProviderRiskDispositionV1 = {
    schemaVersion: "service-role-provider-risk-disposition-v1",
    runId: RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: MANIFEST_HASH,
    canonicalEventId,
    disposition,
    policyVersion: "tronscan-risk-transaction-boolean-v1",
    transactionInfoEvidenceId: "tron-transaction-provider-evidence-v1:test",
    transactionInfoPayloadSha256: "a".repeat(64),
    riskTransaction: false,
    binding: "transaction_level_negative"
  };
  return { sha256: fingerprintCanonicalArtifact(artifact), artifact };
}

function fixture() {
  const recentStart = 1_720_000_000;
  const recent = Array.from({ length: 100 }, (_, index) => event(index, recentStart - index));
  const historical = Array.from({ length: 100 }, (_, index) =>
    event(index + 100, recentStart - 8 * 24 * 60 * 60 - index)
  );
  const events = [...recent, ...historical];
  const state: TraversalStateV1 = {
    address: PROFILED,
    direction: "backward",
    anchorTimestamp: recent[0]!.blockTimestamp.toISOString(),
    fundingEpisodeId: "episode-1",
    allocatedAmountRaw: "1",
    sourceEventIds: [canonicalTronUsdtEventKey(recent[0]!)]
  };
  const localEvidence = events.map((item) => {
    const canonicalEventId = canonicalTronUsdtEventKey(item);
    return {
      canonicalEventId,
      transactionInfo: transactionEvidence(item),
      poisoning: poisoning(canonicalEventId),
      providerRisk: providerRisk(canonicalEventId)
    };
  });
  const input = (overrides: Record<string, unknown> = {}) => ({
    shadowInput: {
      mode: "service-role-shadow-100-plus-100-v1" as const,
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      state,
      acceptedHistory: {
        manifestKey: "manifest-1",
        manifestSha256: MANIFEST_HASH,
        pageArtifactHashes: ["d".repeat(64)],
        events
      }
    },
    localEvidence,
    ...overrides
  });
  return { events, state, localEvidence, input };
}

function gasFreePayload(item: IndexedTronUsdtTransfer, fee: boolean) {
  const row = (toAddress: string, amountRaw: string) => ({
    from_address: PROFILED,
    to_address: toAddress,
    amount_str: amountRaw,
    contract_address: USDT,
    status: 0,
    tokenInfo: { tokenId: USDT, tokenAbbr: "USDT", tokenType: "trc20" }
  });
  const rows = fee
    ? [row(RECEIVER, "97000000"), row(FEE, "3000000")]
    : [row(RECEIVER, "97000000")];
  return {
    hash: item.txHash,
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    contractData: {
      contract_address: CONTROLLER,
      data: permitData(97_000_000n, fee ? 3_000_000n : 0n)
    },
    trc20TransferInfo: rows
  };
}

describe("service role map materialization", () => {
  it("materializes exactly 200 ordinary roles with one shared evidence-bundle hash", () => {
    const result = materializeServiceRoleEventMapV1(fixture().input());

    expect(result.coverage).toMatchObject({
      schemaVersion: "service-role-materialization-coverage-v1",
      sampledEventCount: 200,
      fullyAuthorizedEventCount: 200,
      roleCounts: {
        ordinary: 200,
        poisoning_only: 0,
        gasfree_fee: 0,
        gasfree_principal: 0,
        provider_risk: 0
      },
      missing: [],
      conflicts: []
    });
    expect(result.bundle?.artifact.entries).toHaveLength(200);
    expect(result.map?.artifact.entries).toHaveLength(200);
    expect(result.map?.artifact.entries.every((entry) =>
      entry.evidenceSha256 === result.bundle?.sha256)).toBe(true);
    expect(result.bundle?.sha256).toBe(fingerprintCanonicalArtifact(result.bundle?.artifact));
    expect(result.map?.sha256).toBe(fingerprintCanonicalArtifact(result.map?.artifact));
  });

  it.each([
    ["gasfree_principal", false, RECEIVER, "97000000"],
    ["gasfree_fee", true, FEE, "3000000"]
  ] as const)("resolves exact %s movement identity", (role, fee, toAddress, amountRaw) => {
    const { input, events, localEvidence } = fixture();
    const changed = { ...events[0]!, fromAddress: PROFILED, toAddress, amountRaw };
    const changedId = canonicalTronUsdtEventKey(changed);
    const evidence = {
      ...localEvidence[0]!,
      canonicalEventId: changedId,
      transactionInfo: transactionEvidence(changed, gasFreePayload(changed, fee)),
      poisoning: poisoning(changedId),
      providerRisk: providerRisk(changedId)
    };
    const result = materializeServiceRoleEventMapV1(input({
      shadowInput: {
        ...input().shadowInput,
        state: { ...input().shadowInput.state, sourceEventIds: [changedId] },
        acceptedHistory: {
          ...input().shadowInput.acceptedHistory,
          events: [changed, ...events.slice(1)]
        }
      },
      localEvidence: [evidence, ...localEvidence.slice(1)]
    }));

    expect(result.map?.artifact.entries.find((entry) => entry.canonicalEventId === changedId)?.role)
      .toBe(role);
  });

  it("requires exact negative poisoning and provider-risk dispositions before ordinary", () => {
    const { input, localEvidence } = fixture();
    const canonicalEventId = localEvidence[0]!.canonicalEventId;
    const risky = materializeServiceRoleEventMapV1(input({
      localEvidence: [{
        ...localEvidence[0]!,
        providerRisk: providerRisk(canonicalEventId, "provider_risk")
      }, ...localEvidence.slice(1)]
    }));
    const poisoned = materializeServiceRoleEventMapV1(input({
      localEvidence: [{
        ...localEvidence[0]!,
        poisoning: poisoning(canonicalEventId, "poisoning_only")
      }, ...localEvidence.slice(1)]
    }));

    expect(risky.map?.artifact.entries.find((entry) => entry.canonicalEventId === canonicalEventId)?.role)
      .toBe("provider_risk");
    expect(poisoned.map?.artifact.entries.find((entry) => entry.canonicalEventId === canonicalEventId)?.role)
      .toBe("poisoning_only");
  });

  it("fails closed on duplicate evidence or two positive roles", () => {
    const { input, localEvidence } = fixture();
    const canonicalEventId = localEvidence[0]!.canonicalEventId;
    const duplicate = materializeServiceRoleEventMapV1(input({
      localEvidence: [...localEvidence, localEvidence[0]]
    }));
    const conflicting = materializeServiceRoleEventMapV1(input({
      localEvidence: [{
        ...localEvidence[0]!,
        poisoning: poisoning(canonicalEventId, "poisoning_only"),
        providerRisk: providerRisk(canonicalEventId, "provider_risk")
      }, ...localEvidence.slice(1)]
    }));

    expect(duplicate.map).toBeNull();
    expect(duplicate.coverage.conflicts).toContainEqual(expect.objectContaining({ canonicalEventId }));
    expect(conflicting.map).toBeNull();
    expect(conflicting.coverage.conflicts).toContainEqual({
      canonicalEventId,
      roles: ["poisoning_only", "provider_risk"]
    });
  });

  it("returns coverage only for one missing witness, page-only false risk, missing transaction info, or 199 entries", () => {
    const { input, localEvidence } = fixture();
    const canonicalEventId = localEvidence[0]!.canonicalEventId;
    const cases = [
      [{ ...localEvidence[0]!, poisoning: null }, ...localEvidence.slice(1)],
      [{ ...localEvidence[0]!, providerRisk: null }, ...localEvidence.slice(1)],
      [{ ...localEvidence[0]!, transactionInfo: null }, ...localEvidence.slice(1)],
      localEvidence.slice(1)
    ];
    const expectedDimensions = ["poisoning_only", "provider_risk", "gasfree", "gasfree"];

    cases.forEach((local, index) => {
      const result = materializeServiceRoleEventMapV1(input({ localEvidence: local }));
      expect(result.bundle).toBeNull();
      expect(result.map).toBeNull();
      expect(result.coverage.fullyAuthorizedEventCount).toBe(199);
      expect(result.coverage.missing).toContainEqual(expect.objectContaining({
        canonicalEventId,
        dimensions: expect.arrayContaining([expectedDimensions[index]!])
      }));
    });
  });

  it("rejects wrong event/run/snapshot/manifest binding and invalid evidence hashes", () => {
    const { input, localEvidence } = fixture();
    const first = localEvidence[0]!;
    const mutations = [
      { ...first.providerRisk.artifact, canonicalEventId: "wrong" },
      { ...first.providerRisk.artifact, runId: "other" },
      { ...first.providerRisk.artifact, snapshotHash: "f".repeat(64) },
      { ...first.providerRisk.artifact, addressHistoryManifestSha256: "e".repeat(64) }
    ];
    for (const artifact of mutations) {
      const result = materializeServiceRoleEventMapV1(input({
        localEvidence: [{
          ...first,
          providerRisk: { sha256: fingerprintCanonicalArtifact(artifact), artifact }
        }, ...localEvidence.slice(1)]
      }));
      expect(result.map).toBeNull();
      expect(result.coverage.fullyAuthorizedEventCount).toBe(199);
    }
    const invalidHash = materializeServiceRoleEventMapV1(input({
      localEvidence: [{
        ...first,
        providerRisk: { ...first.providerRisk, sha256: "f".repeat(64) }
      }, ...localEvidence.slice(1)]
    }));
    expect(invalidHash.map).toBeNull();
  });

  it("requires every permanent poisoning and provider-risk disposition field", () => {
    const { input, localEvidence } = fixture();
    const first = localEvidence[0]!;
    const malformed = [
      {
        ...first,
        poisoning: (() => {
          const { reason: _reason, ...artifact } = first.poisoning.artifact;
          return { sha256: fingerprintCanonicalArtifact(artifact), artifact: artifact as unknown as ServiceRolePoisoningDispositionV1 };
        })()
      },
      {
        ...first,
        providerRisk: (() => {
          const { binding: _binding, ...artifact } = first.providerRisk.artifact;
          return { sha256: fingerprintCanonicalArtifact(artifact), artifact: artifact as unknown as ServiceRoleProviderRiskDispositionV1 };
        })()
      }
    ];

    for (const evidence of malformed) {
      const result = materializeServiceRoleEventMapV1(input({ localEvidence: [evidence, ...localEvidence.slice(1)] }));
      expect(result.map).toBeNull();
      expect(result.coverage.fullyAuthorizedEventCount).toBe(199);
    }
  });

  it("does not treat a registered-controller parser failure as non-GasFree", () => {
    const { input, events, localEvidence } = fixture();
    const item = events[0]!;
    const ambiguous = {
      ...providerPayload(item),
      contractData: { contract_address: CONTROLLER, data: "6f21b898" }
    };
    const result = materializeServiceRoleEventMapV1(input({
      localEvidence: [{
        ...localEvidence[0]!,
        transactionInfo: transactionEvidence(item, ambiguous)
      }, ...localEvidence.slice(1)]
    }));

    expect(result.map).toBeNull();
    expect(result.coverage.missing[0]).toMatchObject({ dimensions: ["gasfree"] });
  });

  it("is deterministic across evidence input order", () => {
    const { input, localEvidence } = fixture();
    const forward = materializeServiceRoleEventMapV1(input());
    const reverse = materializeServiceRoleEventMapV1(input({
      localEvidence: [...localEvidence].reverse()
    }));

    expect(reverse).toEqual(forward);
  });

  it("binds coverage identity to the traversal state", () => {
    const { input } = fixture();
    const firstInput = input();
    const first = materializeServiceRoleEventMapV1(firstInput);
    const same = materializeServiceRoleEventMapV1(firstInput);
    const other = materializeServiceRoleEventMapV1(input({
      shadowInput: {
        ...firstInput.shadowInput,
        state: { ...firstInput.shadowInput.state, fundingEpisodeId: "episode-2" }
      }
    }));

    expect(first.coverage.traversalStateIds).toHaveLength(1);
    expect(fingerprintCanonicalArtifact(same.coverage)).toBe(fingerprintCanonicalArtifact(first.coverage));
    expect(fingerprintCanonicalArtifact(other.coverage)).not.toBe(fingerprintCanonicalArtifact(first.coverage));
  });
});
