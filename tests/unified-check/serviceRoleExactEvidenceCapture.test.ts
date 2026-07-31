import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";

import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import {
  buildServiceRoleExactEvidenceCaptureManifestV1,
  evaluateServiceRoleExactEvidenceCaptureV1,
  validateServiceRoleExactEvidenceCaptureReceiptV1
} from "../../src/unifiedCheck/serviceRoleExactEvidenceCapture.js";
import { TRON_USDT_CONTRACT_ADDRESS as USDT } from "../../src/parser/transactionParser.js";
import { buildTransactionProviderEvidenceV1, type TronTransactionProviderEvidenceV1 } from "../../src/storage/transactionEvidenceRepository.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import { traversalStateId, type TraversalStateV1 } from "../../src/unifiedCheck/traversal.js";
import { THJ_POISONING_CASE } from "../fixtures/monitor/addressPoisoningCases.js";

const HASH = "a".repeat(64);
const PAGE_A = "b".repeat(64);
const PAGE_B = "c".repeat(64);
const SUBJECT = "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8";
const PROFILED = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";
const GASFREE_CONTROLLER = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
const GASFREE_ACCOUNT = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
const GASFREE_RECEIVER = "TMwjbNHpsVSjn93vtWtLnThHwhAJAnrWNq";
const GASFREE_FEE = "TFNX7TKYCm1kUYDECjkrogBwYZvt69XQNy";

function event(index: number, timestamp: number): IndexedTronUsdtTransfer {
  return {
    transferId: `transfer-${index}`,
    txHash: `ABC${index.toString(16).padStart(61, "0")}`,
    blockNumber: 20_000 - index,
    blockTimestamp: new Date(timestamp * 1_000),
    eventIndex: 0,
    provider: "tronscan",
    providerRowOrdinalInTx: index,
    fromAddress: `TX${index.toString().padStart(32, "1")}`,
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

function fixture() {
  const recentStart = 1_720_000_000;
  const recent = Array.from({ length: 100 }, (_, index) => event(index, recentStart - index));
  const historical = Array.from({ length: 100 }, (_, index) =>
    event(index + 100, recentStart - 8 * 24 * 60 * 60 - index)
  );
  const events = [...recent, ...historical];
  const state = (suffix: string): TraversalStateV1 => ({
    address: PROFILED,
    direction: "backward",
    anchorTimestamp: recent[0]!.blockTimestamp.toISOString(),
    fundingEpisodeId: `episode-${suffix}`,
    allocatedAmountRaw: "1",
    sourceEventIds: ["source-z", canonicalTronUsdtEventKey(recent[0]!)]
  });
  const anchor = recent[0]!.blockTimestamp.toISOString();
  const acceptedHistory = {
    manifestKey: "manifest-1",
    manifestSha256: HASH,
    pageArtifactHashes: [PAGE_B, PAGE_A],
    events
  };
  return {
    events,
    states: ["g", "f", "e", "d", "c", "b", "a"].map(state),
    input: (overrides: Record<string, unknown> = {}) => ({
      runId: "run-1",
      snapshotHash: HASH,
      subjectAddress: SUBJECT,
      states: ["g", "f", "e", "d", "c", "b", "a"].map(state),
      anchor,
      acceptedHistory,
      ...overrides
    })
  };
}

const uintWord = (value: bigint) => value.toString(16).padStart(64, "0");
const addressWord = (address: string) => TronWeb.address.toHex(address).slice(2).padStart(64, "0");

function gasFreeData(value: bigint, maxFee: bigint): string {
  const signature = "11".repeat(65);
  return [
    "6f21b898", addressWord(USDT), addressWord(SUBJECT), addressWord(GASFREE_RECEIVER),
    uintWord(value), uintWord(maxFee), uintWord(1_800_000_000n), uintWord(1n), uintWord(9n),
    uintWord(0x120n), uintWord(65n), signature.padEnd(192, "0")
  ].join("");
}

function gasFreePayload(item: IndexedTronUsdtTransfer, fee = false): Record<string, unknown> {
  const row = (toAddress: string, amountRaw: string) => ({
    from_address: PROFILED,
    to_address: toAddress,
    amount_str: amountRaw,
    contract_address: USDT,
    tokenInfo: { tokenId: USDT }
  });
  const rows = fee ? [row(GASFREE_RECEIVER, "97000000"), row(GASFREE_FEE, "3000000")]
    : [row(GASFREE_RECEIVER, "97000000")];
  return {
    hash: item.txHash, confirmed: true, contractRet: "SUCCESS", revert: false, riskTransaction: false,
    contractData: { contract_address: GASFREE_CONTROLLER, data: gasFreeData(97_000_000n, fee ? 3_000_000n : 0n) },
    trc20TransferInfo: rows
  };
}

function completeFixture(transform = (events: IndexedTronUsdtTransfer[]) => events) {
  const base = fixture();
  const events = transform(base.events.map((item) => ({
    ...item,
    txHash: item.txHash.toLowerCase(),
    fromAddress: SUBJECT,
    toAddress: PROFILED
  })));
  const sourceEventIds = ["source-z", canonicalTronUsdtEventKey(events[0]!)];
  const manifest = buildServiceRoleExactEvidenceCaptureManifestV1(base.input({
    states: base.input().states.map((state) => ({ ...state, sourceEventIds })),
    anchor: events[0]!.blockTimestamp.toISOString(),
    acceptedHistory: { ...base.input().acceptedHistory, events }
  }));
  const payloadFor = (item: IndexedTronUsdtTransfer, riskTransaction = false) => ({
      hash: item.txHash,
      confirmed: true,
      contractRet: "SUCCESS",
      revert: false,
      riskTransaction,
      contractData: { contract_address: SUBJECT, data: "a9059cbb" },
      trc20TransferInfo: riskTransaction ? [{
        from_address: item.fromAddress,
        to_address: item.toAddress,
        amount_str: item.amountRaw,
        contract_address: USDT
      }] : []
    });
  const evidence = (item: IndexedTronUsdtTransfer, riskTransaction = false, payload: unknown = payloadFor(item, riskTransaction)): TronTransactionProviderEvidenceV1 => {
    return buildTransactionProviderEvidenceV1({
      identity: {
        version: "tron-transaction-provider-evidence-v1",
        chain: "tron",
        txHash: item.txHash,
        provider: "tronscan",
        endpoint: "transaction-info",
        providerSchemaVersion: 1
      },
      payload,
      fetchedAt: "2026-07-30T00:00:00.000Z",
      movement: null
    });
  };
  return {
    events,
    manifest,
    evidence,
    payloadFor,
    transactionEvidence: (riskIndex: number | null = null) => new Map(events.map((item, index) => [
      item.txHash,
      evidence(item, index === riskIndex)
    ]))
  };
}

function evaluation(source: ReturnType<typeof completeFixture>) {
  return evaluateServiceRoleExactEvidenceCaptureV1({
    manifest: source.manifest,
    acceptedEvents: source.events,
    transactionEvidence: source.transactionEvidence()
  });
}

function validationInput(source: ReturnType<typeof completeFixture>, result = evaluation(source)) {
  return {
    manifest: source.manifest,
    receipt: result.receipt!,
    acceptedEvents: source.events,
    transactionEvidence: source.transactionEvidence(),
    poisoning: new Map(result.poisoning.map((item) => [item.artifact.canonicalEventId, item])),
    providerRisk: new Map(result.providerRisk.map((item) => [item.artifact.canonicalEventId, item]))
  };
}

describe("service role exact evidence capture", () => {
  it("fails closed until every sampled transaction has bound exact evidence", () => {
    const { input, events } = fixture();
    const manifest = buildServiceRoleExactEvidenceCaptureManifestV1(input());
    const result = evaluateServiceRoleExactEvidenceCaptureV1({
      manifest,
      acceptedEvents: events,
      transactionEvidence: new Map()
    });

    expect(result.receipt).toBeNull();
    expect(result.poisoning).toEqual([]);
    expect(result.providerRisk).toEqual([]);
    expect(result.coverage.sampledEventCount).toBe(200);
    expect(result.coverage.unresolved).toHaveLength(200);
  });

  it("reports deduplicated canonical transaction hashes for missing shared evidence", () => {
    const source = completeFixture((events) => events.map((event, index) => index === 1
      ? { ...event, txHash: events[0]!.txHash, eventIndex: 1, transferId: "same-transaction-distinct-event" }
      : event));
    const transactionEvidence = source.transactionEvidence();
    transactionEvidence.delete(source.events[0]!.txHash);

    const result = evaluateServiceRoleExactEvidenceCaptureV1({
      manifest: source.manifest,
      acceptedEvents: source.events,
      transactionEvidence
    });

    expect(result.receipt).toBeNull();
    expect(result.coverage.missingTransactionHashes).toEqual([source.events[0]!.txHash]);
  });

  it("derives a complete deterministic ordinary receipt and validates its exact bound artifacts", () => {
    const source = completeFixture();
    const first = evaluateServiceRoleExactEvidenceCaptureV1({
      manifest: source.manifest,
      acceptedEvents: source.events,
      transactionEvidence: source.transactionEvidence()
    });
    const second = evaluateServiceRoleExactEvidenceCaptureV1({
      manifest: source.manifest,
      acceptedEvents: [...source.events].reverse(),
      transactionEvidence: source.transactionEvidence()
    });

    expect(first.receipt).not.toBeNull();
    expect(first).toEqual(second);
    expect(first.receipt?.artifact.entries).toHaveLength(200);
    expect(first.receipt?.artifact.entries.every((entry) => entry.role === "ordinary")).toBe(true);
    expect(Object.keys(first.receipt!.artifact).sort()).toEqual([
      "addressHistoryManifestSha256", "captureManifestSha256", "entries", "policyVersion", "runId",
      "sampledCanonicalEventIds", "schemaVersion", "snapshotHash"
    ]);
    expect(Object.keys(first.coverage).sort()).toEqual([
      "addressHistoryManifestSha256", "captureManifestSha256", "completedReceiptSha256",
      "fullyResolvedEventCount", "missingTransactionHashes", "runId", "sampledEventCount",
      "schemaVersion", "snapshotHash", "uniqueTransactionCount", "unresolved", "validTransactionEvidenceCount"
    ]);
    expect(validateServiceRoleExactEvidenceCaptureReceiptV1({
      manifest: source.manifest,
      receipt: first.receipt!,
      acceptedEvents: source.events,
      transactionEvidence: source.transactionEvidence(),
      poisoning: new Map(first.poisoning.map((item) => [item.artifact.canonicalEventId, item])),
      providerRisk: new Map(first.providerRisk.map((item) => [item.artifact.canonicalEventId, item]))
    })).toHaveLength(200);
    const tampered = {
      ...first.receipt!,
      artifact: {
        ...first.receipt!.artifact,
        entries: first.receipt!.artifact.entries.map((entry, index) => index === 0
          ? { ...entry, role: "provider_risk" as const }
          : entry)
      }
    };
    expect(() => validateServiceRoleExactEvidenceCaptureReceiptV1({
      manifest: source.manifest,
      receipt: { ...tampered, sha256: fingerprintCanonicalArtifact(tampered.artifact) },
      acceptedEvents: source.events,
      transactionEvidence: source.transactionEvidence(),
      poisoning: new Map(first.poisoning.map((item) => [item.artifact.canonicalEventId, item])),
      providerRisk: new Map(first.providerRisk.map((item) => [item.artifact.canonicalEventId, item]))
    })).toThrow("service_role_exact_evidence_capture_receipt_invalid");
  });

  it("requires one exact official-USDT movement before a true provider risk is positive", () => {
    const source = completeFixture();
    const result = evaluateServiceRoleExactEvidenceCaptureV1({
      manifest: source.manifest,
      acceptedEvents: source.events,
      transactionEvidence: source.transactionEvidence(0)
    });

    expect(result.receipt?.artifact.entries.filter((entry) => entry.role === "provider_risk")).toHaveLength(1);
    expect(result.receipt?.artifact.entries.filter((entry) => entry.role === "ordinary")).toHaveLength(199);
  });

  it("returns incomplete coverage and no persisted artifacts for a rehashed 199-event manifest", () => {
    const source = completeFixture();
    const artifact = {
      ...source.manifest.artifact,
      sample: { ...source.manifest.artifact.sample, historicalCanonicalEventIds: source.manifest.artifact.sample.historicalCanonicalEventIds.slice(1) },
      events: source.manifest.artifact.events.filter((event) =>
        event.canonicalEventId !== source.manifest.artifact.sample.historicalCanonicalEventIds[0])
    };
    const result = evaluateServiceRoleExactEvidenceCaptureV1({
      manifest: { artifact, sha256: fingerprintCanonicalArtifact(artifact) },
      acceptedEvents: source.events,
      transactionEvidence: source.transactionEvidence()
    });
    expect(result.coverage.sampledEventCount).toBe(199);
    expect(result.receipt).toBeNull();
    expect(result.poisoning).toEqual([]);
    expect(result.providerRisk).toEqual([]);
  });

  it.each([
    ["schema", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, schemaVersion: "other" })],
    ["policy", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, policyVersion: "other" })],
    ["parser versions", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, parserVersions: { ...artifact.parserVersions, gasFree: "other" } })],
    ["provider", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, provider: { ...artifact.provider, endpoint: "other" } })],
    ["hundred-event split", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, sample: { recentCanonicalEventIds: artifact.sample.recentCanonicalEventIds.slice(1), historicalCanonicalEventIds: [artifact.sample.recentCanonicalEventIds[0]!, ...artifact.sample.historicalCanonicalEventIds] } })],
    ["page order", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, addressHistory: { ...artifact.addressHistory, pageArtifactHashes: [...artifact.addressHistory.pageArtifactHashes].reverse() } })],
    ["traversal primary", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, traversal: { ...artifact.traversal, primaryStateId: "f".repeat(64) } })],
    ["traversal anchor", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, traversal: { ...artifact.traversal, anchor: "2024-01-01T00:00:00.000Z" } })],
    ["empty run binding", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, runId: "" })],
    ["snapshot binding", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, snapshotHash: "not-a-hash" })],
    ["subject binding", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, subjectAddress: "not-an-address" })],
    ["profile binding", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, profiledAddress: "not-an-address" })],
    ["self subject/profile binding", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, subjectAddress: artifact.profiledAddress })],
    ["exactly seven equivalent states", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({
      ...artifact,
      traversal: { ...artifact.traversal, equivalentStateIds: [artifact.traversal.primaryStateId] }
    })],
    ["accepted manifest binding", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, addressHistory: { ...artifact.addressHistory, manifestSha256: "not-a-hash" } })],
    ["accepted manifest key", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, addressHistory: { ...artifact.addressHistory, manifestKey: "" } })],
    ["empty accepted pages", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, addressHistory: { ...artifact.addressHistory, pageArtifactHashes: [] } })],
    ["direction", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, events: artifact.events.map((event, index) => index === 0 ? { ...event, direction: "outgoing" as const } : event) })]
  ])("rejects rehashed manifest semantic tampering: %s", (_name, change) => {
    const source = completeFixture();
    const artifact = change(source.manifest.artifact) as typeof source.manifest.artifact;
    expect(() => evaluateServiceRoleExactEvidenceCaptureV1({
      manifest: { artifact, sha256: fingerprintCanonicalArtifact(artifact) },
      acceptedEvents: source.events,
      transactionEvidence: source.transactionEvidence()
    })).toThrow(/service_role_exact_evidence_capture_manifest/u);
  });

  it.each([
    ["equivalent state ids", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, traversal: { ...artifact.traversal, equivalentStateIds: [...artifact.traversal.equivalentStateIds].reverse() } })],
    ["traversal source ids", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, traversal: { ...artifact.traversal, sourceEventIds: [...artifact.traversal.sourceEventIds].reverse() } })],
    ["captured events", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, events: [...artifact.events].reverse() })],
    ["non-anchor recent ids", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, sample: { ...artifact.sample, recentCanonicalEventIds: [artifact.sample.recentCanonicalEventIds[0]!, ...artifact.sample.recentCanonicalEventIds.slice(1).reverse()] } })],
    ["historical ids", (artifact: ReturnType<typeof completeFixture>["manifest"]["artifact"]) => ({ ...artifact, sample: { ...artifact.sample, historicalCanonicalEventIds: [...artifact.sample.historicalCanonicalEventIds].reverse() } })]
  ])("rejects rehashed manifest order tampering: %s", (_name, change) => {
    const source = completeFixture();
    const artifact = change(source.manifest.artifact) as typeof source.manifest.artifact;
    expect(() => evaluateServiceRoleExactEvidenceCaptureV1({
      manifest: { artifact, sha256: fingerprintCanonicalArtifact(artifact) },
      acceptedEvents: source.events,
      transactionEvidence: source.transactionEvidence()
    })).toThrow(/service_role_exact_evidence_capture_manifest/u);
  });

  it("records mandatory raw-evidence receipt bindings and semantic disposition authority", () => {
    const source = completeFixture((events) => events.map((event, index) => index === 0
      ? { ...event, fromAddress: PROFILED, toAddress: SUBJECT }
      : event));
    const result = evaluation(source);
    const entry = result.receipt!.artifact.entries[0]!;
    expect(entry).toMatchObject({
      transactionInfoEvidenceId: expect.any(String),
      transactionInfoPayloadSha256: expect.any(String),
      transactionInfoFinalityWitnessSha256: expect.any(String),
      poisoningDispositionSha256: expect.any(String),
      providerRiskDispositionSha256: expect.any(String)
    });
    expect(result.poisoning[0]!.artifact.comparison).toMatchObject({ orderAuthority: "not_applicable" });
    expect(result.providerRisk[0]!.artifact).toMatchObject({
      policyVersion: "tronscan-risk-transaction-boolean-v1",
      binding: "transaction_level_negative"
    });
    expect(evaluation(completeFixture()).poisoning[0]!.artifact.comparison).toMatchObject({ orderAuthority: "strictly_earlier_timestamp" });
  });

  it("rejects missing, extra, and mis-keyed raw transaction evidence before receipt validation", () => {
    const source = completeFixture();
    const result = evaluation(source);
    const input = validationInput(source, result);
    const firstKey = source.events[0]!.txHash;
    const firstEvidence = input.transactionEvidence.get(firstKey)!;
    const cases = [
      new Map([...input.transactionEvidence].filter(([key]) => key !== firstKey)),
      new Map([...input.transactionEvidence, ["extra", firstEvidence]]),
      new Map([...input.transactionEvidence].filter(([key]) => key !== firstKey).concat([["wrong", firstEvidence]]))
    ];
    for (const transactionEvidence of cases) {
      expect(() => validateServiceRoleExactEvidenceCaptureReceiptV1({ ...input, transactionEvidence })).toThrow(/service_role_exact_evidence_capture_/u);
    }
  });

  it("requires evidence at the exact normalized transaction identity key", () => {
    const source = completeFixture();
    const evidence = source.transactionEvidence();
    const item = source.events[0]!;
    const value = evidence.get(item.txHash)!;
    evidence.delete(item.txHash);
    evidence.set("wrong-evidence-id", value);
    expect(evaluateServiceRoleExactEvidenceCaptureV1({ manifest: source.manifest, acceptedEvents: source.events, transactionEvidence: evidence }).receipt).toBeNull();
  });

  it.each([
    ["two official USDT movements", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) =>
      source.evidence(item, true, { ...source.payloadFor(item, true), trc20TransferInfo: [
        ...source.payloadFor(item, true).trc20TransferInfo,
        { ...source.payloadFor(item, true).trc20TransferInfo[0], to_address: SUBJECT }
      ] })],
    ["a sole nonmatching official movement", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) =>
      source.evidence(item, true, { ...source.payloadFor(item, true), trc20TransferInfo: [{
        ...source.payloadFor(item, true).trc20TransferInfo[0], amount_str: "2"
      }] })],
    ["missing riskTransaction", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) => {
      const evidence = source.evidence(item);
      return { ...evidence, payload: { ...evidence.payload as Record<string, unknown>, riskTransaction: undefined } };
    }],
    ["nonboolean riskTransaction", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) => {
      const evidence = source.evidence(item);
      return { ...evidence, payload: { ...evidence.payload as Record<string, unknown>, riskTransaction: "false" } };
    }],
    ["wrong transaction hash", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) => ({ ...source.evidence(item), txHash: "f".repeat(64) })],
    ["wrong endpoint", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) => ({ ...source.evidence(item), endpoint: "gettransactionbyid" as const })],
    ["wrong provider", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) => ({ ...source.evidence(item), provider: "tron_fullnode" as const })],
    ["wrong schema", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) => ({ ...source.evidence(item), providerSchemaVersion: 2 })],
    ["non-success finality", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) => ({ ...source.evidence(item), finality: { ...source.evidence(item).finality, status: "confirmed_failed" as const } })],
    ["payload hash", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) => ({ ...source.evidence(item), payloadSha256: "f".repeat(64) })],
    ["finality witness", (source: ReturnType<typeof completeFixture>, item: IndexedTronUsdtTransfer) => ({ ...source.evidence(item), finality: { ...source.evidence(item).finality, witnessSha256: "f".repeat(64) } })]
  ])("fails closed for invalid transaction evidence: %s", (_name, mutate) => {
    const source = completeFixture();
    const evidence = source.transactionEvidence();
    evidence.set(source.events[0]!.txHash, mutate(source, source.events[0]!) as TronTransactionProviderEvidenceV1);
    const result = evaluateServiceRoleExactEvidenceCaptureV1({ manifest: source.manifest, acceptedEvents: source.events, transactionEvidence: evidence });
    expect(result.receipt).toBeNull();
    expect(result.poisoning).toEqual([]);
    expect(result.providerRisk).toEqual([]);
  });

  it("uses the first nonempty transfer alias, rejects malformed selected aliases, and enforces token and decimal authority", () => {
    const source = completeFixture();
    const item = source.events[0]!;
    const official = source.payloadFor(item, true).trc20TransferInfo[0]!;
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
      ["later conflicting alias ignored", { ...source.payloadFor(item, true), tokenTransferInfo: [{ ...official, contract_address: SUBJECT }] }, true],
      ["malformed selected alias", { ...source.payloadFor(item, true), trc20TransferInfo: [{}], tokenTransferInfo: [official] }, false],
      ["missing token alias", { ...source.payloadFor(item, true), trc20TransferInfo: [{ from_address: item.fromAddress, to_address: item.toAddress, amount_str: item.amountRaw }] }, false],
      ["conflicting token aliases", { ...source.payloadFor(item, true), trc20TransferInfo: [{ ...official, tokenId: SUBJECT }] }, false],
      ["explicit other token ignored", { ...source.payloadFor(item, true), trc20TransferInfo: [official, { ...official, contract_address: SUBJECT, tokenId: SUBJECT }] }, true],
      ["leading zero amount", { ...source.payloadFor(item, true), trc20TransferInfo: [{ ...official, amount_str: "01000000" }] }, false]
    ];
    for (const [_name, payload, complete] of cases) {
      const evidence = source.transactionEvidence();
      evidence.set(item.txHash, source.evidence(item, true, payload));
      const result = evaluateServiceRoleExactEvidenceCaptureV1({ manifest: source.manifest, acceptedEvents: source.events, transactionEvidence: evidence });
      expect(Boolean(result.receipt)).toBe(complete);
    }
  }, 10_000);

  it.each([
    ["principal", false, GASFREE_RECEIVER, "97000000", "gasfree_principal"],
    ["service fee", true, GASFREE_FEE, "3000000", "gasfree_fee"]
  ] as const)("derives exact GasFree %s dispositions", (_name, fee, toAddress, amountRaw, role) => {
    const source = completeFixture((events) => events.map((event, index) => index === 0
      ? { ...event, fromAddress: PROFILED, toAddress, amountRaw }
      : event));
    const evidence = source.transactionEvidence();
    evidence.set(source.events[0]!.txHash, source.evidence(source.events[0]!, false, gasFreePayload(source.events[0]!, fee)));
    const result = evaluateServiceRoleExactEvidenceCaptureV1({ manifest: source.manifest, acceptedEvents: source.events, transactionEvidence: evidence });
    expect(result.receipt?.artifact.entries.find((entry) => entry.canonicalEventId === source.manifest.artifact.events.find((entry) => entry.txHash === source.events[0]!.txHash)!.canonicalEventId)).toMatchObject({
      role,
      gasFree: { disposition: role, settlementSha256: expect.any(String), movementSha256: expect.any(String) }
    });
  });

  it.each([
    ["controller negative", (source: ReturnType<typeof completeFixture>) => source.payloadFor(source.events[0]!)],
    ["selector negative", (source: ReturnType<typeof completeFixture>) => ({
      ...source.payloadFor(source.events[0]!),
      contractData: { contract_address: GASFREE_CONTROLLER, data: `a9059cbb${gasFreeData(1n, 0n).slice(8)}` }
    })],
    ["registered ambiguity", (source: ReturnType<typeof completeFixture>) => ({
      ...source.payloadFor(source.events[0]!),
      contractData: { contract_address: GASFREE_CONTROLLER, data: "6f21b898" }
    })]
  ])("handles GasFree negative and unresolved branches: %s", (_name, payloadForCase) => {
    const source = completeFixture();
    const evidence = source.transactionEvidence();
    evidence.set(source.events[0]!.txHash, source.evidence(source.events[0]!, false, payloadForCase(source)));
    const result = evaluateServiceRoleExactEvidenceCaptureV1({ manifest: source.manifest, acceptedEvents: source.events, transactionEvidence: evidence });
    if (_name.includes("negative")) expect(result.receipt).not.toBeNull();
    else expect(result.receipt).toBeNull();
  });

  it.each(["no exact event movement", "duplicate matching movement"]) ("fails closed for GasFree %s", (kind) => {
    const source = completeFixture((events) => events.map((event, index) => index === 0
      ? { ...event, fromAddress: PROFILED, toAddress: GASFREE_FEE, amountRaw: kind === "no exact event movement" ? "2" : "3000000" }
      : event));
    const payload = gasFreePayload(source.events[0]!, true);
    if (kind === "duplicate matching movement") {
      (payload.trc20TransferInfo as Array<Record<string, unknown>>).push({
        ...(payload.trc20TransferInfo as Array<Record<string, unknown>>)[1]!
      });
    }
    const evidence = source.transactionEvidence();
    evidence.set(source.events[0]!.txHash, source.evidence(source.events[0]!, false, payload));
    expect(evaluateServiceRoleExactEvidenceCaptureV1({ manifest: source.manifest, acceptedEvents: source.events, transactionEvidence: evidence }).receipt).toBeNull();
  });

  it("records the exact outgoing poisoning structural negative", () => {
    const source = completeFixture((events) => events.map((event, index) => index === 0
      ? { ...event, fromAddress: PROFILED, toAddress: SUBJECT }
      : event));
    const result = evaluateServiceRoleExactEvidenceCaptureV1({ manifest: source.manifest, acceptedEvents: source.events, transactionEvidence: source.transactionEvidence() });
    const firstId = source.manifest.artifact.events.find((event) => event.txHash === source.events[0]!.txHash)!.canonicalEventId;
    expect(result.poisoning.find((item) => item.artifact.canonicalEventId === firstId)?.artifact).toMatchObject({
      disposition: "not_poisoning", reason: "not_incoming_to_profiled_address",
      comparison: { windowStart: source.events[0]!.blockTimestamp.toISOString(), windowEnd: source.events[0]!.blockTimestamp.toISOString(), canonicalComparisonEventIds: [], comparisonInventorySha256: fingerprintCanonicalArtifact([]), pageArtifactHashes: [PAGE_A, PAGE_B] }
    });
  });

  it.each([
    ["candidate", THJ_POISONING_CASE.realRecipient, "poisoning_only"],
    ["prior relationship", THJ_POISONING_CASE.lookalike, "not_poisoning"]
  ] as const)("derives poisoning %s from accepted all-time history", (_name, priorReceiver, disposition) => {
    const source = completeFixture((events) => events.map((event, index) => index === 0
      ? { ...event, fromAddress: THJ_POISONING_CASE.lookalike, toAddress: PROFILED, amountRaw: THJ_POISONING_CASE.amountRaw }
      : index === 1
        ? { ...event, fromAddress: PROFILED, toAddress: priorReceiver, amountRaw: _name === "candidate" ? THJ_POISONING_CASE.amountRaw : "1" }
        : event));
    const result = evaluateServiceRoleExactEvidenceCaptureV1({ manifest: source.manifest, acceptedEvents: source.events, transactionEvidence: source.transactionEvidence() });
    const firstId = source.manifest.artifact.events.find((event) => event.txHash === source.events[0]!.txHash)!.canonicalEventId;
    expect(result.receipt).not.toBeNull();
    expect(result.poisoning.find((item) => item.artifact.canonicalEventId === firstId)?.artifact.disposition).toBe(disposition);
    expect(result.receipt?.artifact.entries.find((entry) => entry.canonicalEventId === firstId)?.role).toBe(disposition === "poisoning_only" ? "poisoning_only" : "ordinary");
  });

  it("fails closed on poisoning same-timestamp ambiguity and invalid comparison transfers", () => {
    const sameTimestamp = completeFixture((events) => events.map((event, index) => index === 1
      ? { ...event, blockTimestamp: events[0]!.blockTimestamp }
      : event));
    expect(evaluateServiceRoleExactEvidenceCaptureV1({ manifest: sameTimestamp.manifest, acceptedEvents: sameTimestamp.events, transactionEvidence: sameTimestamp.transactionEvidence() }).receipt).toBeNull();

    const source = completeFixture();
    const invalid = { ...source.events[1]!, txHash: "e".repeat(64), transferId: "invalid", fromAddress: "not-an-address" };
    expect(evaluateServiceRoleExactEvidenceCaptureV1({
      manifest: source.manifest,
      acceptedEvents: [...source.events, invalid],
      transactionEvidence: source.transactionEvidence()
    }).receipt).toBeNull();
  });

  it("binds poisoning comparison to sorted inventory and exact half-open 24-hour bounds", () => {
    const source = completeFixture((events) => events.map((event, index) => index === 0
      ? { ...event, fromAddress: THJ_POISONING_CASE.lookalike, amountRaw: THJ_POISONING_CASE.amountRaw }
      : event));
    const at = source.events[0]!.blockTimestamp.getTime();
    const exactLower = { ...source.events[1]!, txHash: "d".repeat(64), transferId: "lower", fromAddress: PROFILED, toAddress: THJ_POISONING_CASE.realRecipient, amountRaw: THJ_POISONING_CASE.amountRaw, blockTimestamp: new Date(at - 24 * 60 * 60 * 1_000) };
    const tooOld = { ...exactLower, txHash: "c".repeat(64), transferId: "old", blockTimestamp: new Date(at - 24 * 60 * 60 * 1_000 - 1) };
    const result = evaluateServiceRoleExactEvidenceCaptureV1({ manifest: source.manifest, acceptedEvents: [...source.events, tooOld, exactLower], transactionEvidence: source.transactionEvidence() });
    const firstId = source.manifest.artifact.events.find((event) => event.txHash === source.events[0]!.txHash)!.canonicalEventId;
    const comparison = result.poisoning.find((item) => item.artifact.canonicalEventId === firstId)!.artifact.comparison!;
    expect(comparison.windowStart).toBe(exactLower.blockTimestamp.toISOString());
    expect(comparison.windowEnd).toBe(source.events[0]!.blockTimestamp.toISOString());
    expect(comparison.canonicalComparisonEventIds).toEqual([...comparison.canonicalComparisonEventIds].sort());
    expect(comparison.canonicalComparisonEventIds).toContain(canonicalTronUsdtEventKey(exactLower));
    expect(comparison.canonicalComparisonEventIds).not.toContain(canonicalTronUsdtEventKey(tooOld));
    expect(comparison.comparisonInventorySha256).toBe(fingerprintCanonicalArtifact(comparison.canonicalComparisonEventIds));
  });

  it("fails closed for multi-positive composition while preserving all single positive roles", () => {
    const source = completeFixture((events) => events.map((event, index) => index === 0
      ? { ...event, fromAddress: PROFILED, toAddress: GASFREE_RECEIVER, amountRaw: "97000000" }
      : event));
    const evidence = source.transactionEvidence();
    evidence.set(source.events[0]!.txHash, source.evidence(source.events[0]!, true, { ...gasFreePayload(source.events[0]!), riskTransaction: true }));
    const result = evaluateServiceRoleExactEvidenceCaptureV1({ manifest: source.manifest, acceptedEvents: source.events, transactionEvidence: evidence });
    expect(result.receipt).toBeNull();
    expect(result.poisoning).toEqual([]);
    expect(result.providerRisk).toEqual([]);
    expect(result.coverage.unresolved.find((entry) => entry.reasons.includes("role_conflict"))).toBeTruthy();
  });

  it("reports the actual poisoning and provider-risk conflict dimensions", () => {
    const source = completeFixture((events) => events.map((event, index) => index === 0
      ? { ...event, fromAddress: THJ_POISONING_CASE.lookalike, toAddress: PROFILED, amountRaw: THJ_POISONING_CASE.amountRaw }
      : index === 1
        ? { ...event, fromAddress: PROFILED, toAddress: THJ_POISONING_CASE.realRecipient, amountRaw: THJ_POISONING_CASE.amountRaw }
        : event));
    const result = evaluateServiceRoleExactEvidenceCaptureV1({
      manifest: source.manifest,
      acceptedEvents: source.events,
      transactionEvidence: source.transactionEvidence(0)
    });
    const firstId = source.manifest.artifact.events.find((event) => event.txHash === source.events[0]!.txHash)!.canonicalEventId;

    expect(result.receipt).toBeNull();
    expect(result.coverage.unresolved.find((entry) => entry.canonicalEventId === firstId)).toMatchObject({
      dimensions: ["provider_risk", "poisoning_only"],
      reasons: ["role_conflict"]
    });
  });

  it("deduplicates repeated false-risk transaction evidence but keeps per-event GasFree binding", () => {
    const source = completeFixture((events) => events.map((event, index) => index === 1
      ? { ...event, txHash: events[0]!.txHash, eventIndex: 1, transferId: "same-transaction-distinct-event" }
      : event));
    const result = evaluation(source);
    expect(result.receipt).not.toBeNull();
    expect(result.coverage.uniqueTransactionCount).toBe(199);
    expect(result.coverage.validTransactionEvidenceCount).toBe(199);
    expect(result.receipt?.artifact.entries).toHaveLength(200);
  });

  it("is deterministic across accepted event and transaction-evidence map insertion order", () => {
    const source = completeFixture();
    const first = evaluation(source);
    const reverse = new Map([...source.transactionEvidence()].reverse());
    const second = evaluateServiceRoleExactEvidenceCaptureV1({
      manifest: source.manifest,
      acceptedEvents: [...source.events].reverse(),
      transactionEvidence: reverse
    });
    expect(second).toEqual(first);
  });

  it("rejects every receipt, disposition, raw-evidence, manifest, and event binding mutation", () => {
    const source = completeFixture();
    const result = evaluation(source);
    const input = validationInput(source, result);
    expect(validateServiceRoleExactEvidenceCaptureReceiptV1(input)).toHaveLength(200);
    const firstId = result.receipt!.artifact.entries[0]!.canonicalEventId;
    const variants = [
      { ...input, manifest: { ...input.manifest, sha256: "f".repeat(64) } },
      { ...input, receipt: { ...input.receipt, sha256: "f".repeat(64) } },
      { ...input, receipt: { ...input.receipt, artifact: { ...input.receipt.artifact, entries: input.receipt.artifact.entries.slice(1) } } },
      { ...input, receipt: { ...input.receipt, artifact: { ...input.receipt.artifact, entries: [...input.receipt.artifact.entries, input.receipt.artifact.entries[0]!] } } },
      { ...input, receipt: { ...input.receipt, artifact: { ...input.receipt.artifact, entries: input.receipt.artifact.entries.map((entry, index) => index === 0 ? { ...entry, transactionInfoEvidenceId: undefined } as never : entry) } } },
      { ...input, receipt: { ...input.receipt, artifact: { ...input.receipt.artifact, entries: input.receipt.artifact.entries.map((entry, index) => index === 0 ? { ...entry, transactionInfoPayloadSha256: "f".repeat(64) } : entry) } } },
      { ...input, receipt: { ...input.receipt, artifact: { ...input.receipt.artifact, entries: input.receipt.artifact.entries.map((entry, index) => index === 0 ? { ...entry, transactionInfoFinalityWitnessSha256: "f".repeat(64) } : entry) } } },
      { ...input, poisoning: new Map([...input.poisoning].filter(([id]) => id !== firstId)) },
      { ...input, poisoning: new Map([...input.poisoning, ["extra", input.poisoning.get(firstId)!]]) },
      { ...input, providerRisk: new Map([...input.providerRisk].filter(([id]) => id !== firstId)) },
      { ...input, providerRisk: new Map([...input.providerRisk, ["extra", input.providerRisk.get(firstId)!]]) },
      { ...input, poisoning: new Map(input.poisoning).set(firstId, { ...input.poisoning.get(firstId)!, sha256: "f".repeat(64) }) },
      { ...input, providerRisk: new Map(input.providerRisk).set(firstId, { ...input.providerRisk.get(firstId)!, sha256: "f".repeat(64) }) },
      { ...input, transactionEvidence: new Map(input.transactionEvidence).set(source.events[0]!.txHash, { ...input.transactionEvidence.get(source.events[0]!.txHash)!, payloadSha256: "f".repeat(64) }) },
      { ...input, transactionEvidence: new Map(input.transactionEvidence).set(source.events[0]!.txHash, { ...input.transactionEvidence.get(source.events[0]!.txHash)!, finality: { ...input.transactionEvidence.get(source.events[0]!.txHash)!.finality, witnessSha256: "f".repeat(64) } }) },
      { ...input, acceptedEvents: source.events.map((event, index) => index === 0 ? { ...event, amountRaw: "2" } : event) }
    ];
    for (const variant of variants) {
      expect(() => validateServiceRoleExactEvidenceCaptureReceiptV1(variant)).toThrow(/service_role_exact_evidence_capture_/u);
    }
  }, 20_000);

  it("captures exact hundred-event windows using a lexical primary equivalent state", () => {
    const { input, states } = fixture();
    const output = buildServiceRoleExactEvidenceCaptureManifestV1(input());

    expect(output.artifact).toMatchObject({
      schemaVersion: "service-role-exact-evidence-capture-manifest-v1",
      policyVersion: "existing-hash-bound-economic-role-v1",
      profiledAddress: PROFILED,
      addressHistory: { pageArtifactHashes: [PAGE_A, PAGE_B] },
      provider: { chain: "tron", provider: "tronscan", endpoint: "transaction-info", providerSchemaVersion: 1 }
    });
    expect(output.artifact.traversal.primaryStateId).toBe([...states]
      .map(traversalStateId).sort()[0]);
    expect(output.artifact.traversal.equivalentStateIds).toHaveLength(7);
    expect(output.artifact.traversal.equivalentStateIds).toEqual([...output.artifact.traversal.equivalentStateIds].sort());
    expect(output.artifact.traversal.sourceEventIds).toEqual([...output.artifact.traversal.sourceEventIds].sort());
    expect(output.artifact.sample.recentCanonicalEventIds).toHaveLength(100);
    expect(output.artifact.sample.historicalCanonicalEventIds).toHaveLength(100);
    expect(output.artifact.events).toHaveLength(200);
    expect(output.artifact.events.every((item) => item.txHash === item.txHash.toLowerCase())).toBe(true);
    expect(output.sha256).toBe(fingerprintCanonicalArtifact(output.artifact));
  });

  it("binds only the lexical primary state's source events when equivalent states have distinct sources", () => {
    const { input, states } = fixture();
    const anchorEventId = canonicalTronUsdtEventKey(input().acceptedHistory.events[0]!);
    const distinct = states.map((state, index) => ({ ...state, sourceEventIds: [anchorEventId, `source-${index}`] }));
    const primary = [...distinct].sort((left, right) => traversalStateId(left).localeCompare(traversalStateId(right)))[0]!;
    const output = buildServiceRoleExactEvidenceCaptureManifestV1({
      ...input(),
      states: distinct,
      anchor: distinct[0]!.anchorTimestamp
    });

    expect(output.artifact.traversal.primaryStateId).toBe(traversalStateId(primary));
    expect(output.artifact.traversal.sourceEventIds).toEqual([...primary.sourceEventIds].sort());
  });

  it("emits only the permanent manifest schema and passes structural evaluation", () => {
    const { input, events } = fixture();
    const manifest = buildServiceRoleExactEvidenceCaptureManifestV1(input());

    expect(Object.keys(manifest.artifact).sort()).toEqual([
      "addressHistory", "events", "parserVersions", "policyVersion", "profiledAddress", "provider",
      "runId", "sample", "schemaVersion", "snapshotHash", "subjectAddress", "traversal"
    ]);
    expect(Object.keys(manifest.artifact.traversal).sort()).toEqual([
      "anchor", "equivalentStateIds", "primaryStateId", "sourceEventIds"
    ]);
    expect(Object.keys(manifest.artifact.provider).sort()).toEqual([
      "chain", "endpoint", "provider", "providerSchemaVersion"
    ]);
    expect(() => evaluateServiceRoleExactEvidenceCaptureV1({
      manifest,
      acceptedEvents: events,
      transactionEvidence: new Map()
    })).not.toThrow();
  });

  it("is deterministic across state, page, and event input order", () => {
    const { input, states, events } = fixture();
    const left = buildServiceRoleExactEvidenceCaptureManifestV1(input());
    const right = buildServiceRoleExactEvidenceCaptureManifestV1(input({
      states: [...states].reverse(),
      acceptedHistory: { ...input().acceptedHistory, pageArtifactHashes: [...input().acceptedHistory.pageArtifactHashes].reverse(), events: [...events].reverse() }
    }));
    expect(right).toEqual(left);
  });

  it.each([
    ["empty run id", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({ ...input, runId: "" })],
    ["non-canonical subject address", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({ ...input, subjectAddress: "not-an-address" })],
    ["self subject/profile address", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({ ...input, subjectAddress: PROFILED })],
    ["not exactly seven equivalent states", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({ ...input, states: input.states.slice(1) })],
    ["no accepted-history pages", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input, acceptedHistory: { ...input.acceptedHistory, pageArtifactHashes: [] }
    })],
    ["duplicate sampled ids", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input,
      acceptedHistory: { ...input.acceptedHistory, events: [...input.acceptedHistory.events, { ...input.acceptedHistory.events[0]! }] }
    })],
    ["sample mismatch", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input,
      states: [{ ...input.states[0]!, anchorTimestamp: new Date(Date.parse(input.anchor) - 1_000).toISOString() }, ...input.states.slice(1)]
    })],
    ["wrong anchor", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({ ...input, anchor: "2024-01-01T00:00:00.000Z" })],
    ["self direction", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input, acceptedHistory: { ...input.acceptedHistory, events: input.acceptedHistory.events.map((item, index) => index === 0 ? { ...item, fromAddress: PROFILED } : item) }
    })],
    ["unrelated direction", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input, acceptedHistory: { ...input.acceptedHistory, events: input.acceptedHistory.events.map((item, index) => index === 0 ? { ...item, toAddress: SUBJECT } : item) }
    })],
    ["tampered canonical body", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input, acceptedHistory: { ...input.acceptedHistory, events: [...input.acceptedHistory.events, { ...input.acceptedHistory.events[0]!, amountRaw: "2" }] }
    })]
  ])("rejects %s", (_name, change) => {
    expect(() => buildServiceRoleExactEvidenceCaptureManifestV1(change(fixture().input()))).toThrow();
  });
});
