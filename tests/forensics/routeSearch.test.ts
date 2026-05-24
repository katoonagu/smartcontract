import { describe, expect, it, vi } from "vitest";
import { runForensicRouteSearch } from "../../src/forensics/routeSearch";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";

const source = "TSource111111111111111111111111111111";
const hop = "THop1111111111111111111111111111111";
const target = "TTarget111111111111111111111111111111";

function transfer(overrides: Partial<RawTronscanTrc20Transfer> = {}): RawTronscanTrc20Transfer {
  return {
    transaction_id: overrides.transaction_id ?? "tx-1",
    from_address: overrides.from_address ?? source,
    to_address: overrides.to_address ?? target,
    quant: overrides.quant ?? "320000000000",
    contract_address: overrides.contract_address ?? TRON_USDT_CONTRACT_ADDRESS,
    confirmed: overrides.confirmed ?? true,
    contractRet: overrides.contractRet ?? "SUCCESS",
    block_ts: overrides.block_ts ?? new Date("2026-05-05T10:00:00.000Z").getTime(),
    trigger_info: overrides.trigger_info,
    tokenInfo: overrides.tokenInfo,
    finalResult: overrides.finalResult,
    revert: overrides.revert,
    status: overrides.status
  };
}

describe("forensic route search", () => {
  it("builds direct and hop candidate paths while filtering failed and non-USDT transfers", async () => {
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({ transaction_id: "direct", to_address: target }),
            transfer({ transaction_id: "to-hop", to_address: hop }),
            transfer({ transaction_id: "failed", to_address: target, contractRet: "REVERT" }),
            transfer({ transaction_id: "not-usdt", to_address: target, contract_address: "TNotUsdt1111111111111111111111111111" })
          ];
        }
        if (address === hop) {
          return [transfer({ transaction_id: "hop-target", from_address: hop, to_address: target, quant: "318000000000" })];
        }
        if (address === target) {
          return [transfer({ transaction_id: "target-in", from_address: hop, to_address: target, quant: "318000000000" })];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      amountUsdt: "320000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5
    });

    expect(report.paths.map((path) => path.pathAddresses)).toEqual(
      expect.arrayContaining([
        [source, target],
        [source, hop, target]
      ])
    );
    expect(report.paths.flatMap((path) => path.edges.map((edge) => edge.txHash))).not.toContain("failed");
    expect(report.paths.flatMap((path) => path.edges.map((edge) => edge.txHash))).not.toContain("not-usdt");
  });

  it("enforces page and depth caps during graph collection", async () => {
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string, options?: { start?: number }) => {
        if (address === source && options?.start === 0) {
          return [transfer({ transaction_id: "to-hop", to_address: hop })];
        }
        return [];
      })
    };

    await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 1,
      maxPagesPerAddress: 1,
      pageLimit: 1,
      limit: 5
    });

    expect(client.listRelatedTrc20Transfers.mock.calls.filter(([address]) => address === source)).toHaveLength(1);
    expect(client.listRelatedTrc20Transfers.mock.calls.some(([address]) => address === hop)).toBe(false);
  });

  it("rejects exact candidate paths whose hops go backward in time", async () => {
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({
              transaction_id: "source-hop",
              from_address: source,
              to_address: hop,
              block_ts: Date.parse("2026-05-05T10:00:00.000Z")
            })
          ];
        }
        if (address === hop) {
          return [
            transfer({
              transaction_id: "hop-target-before",
              from_address: hop,
              to_address: target,
              block_ts: Date.parse("2026-05-05T09:59:00.000Z")
            })
          ];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      amountUsdt: "320000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5
    });

    expect(report.paths.map((path) => path.pathAddresses)).not.toContainEqual([source, hop, target]);
    expect(report.case.status).not.toBe("completed");
  });

  it("keeps same-timestamp candidate hops valid because TronScan timestamps are coarse", async () => {
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({
              transaction_id: "source-hop",
              from_address: source,
              to_address: hop,
              block_ts: Date.parse("2026-05-05T10:00:00.000Z")
            })
          ];
        }
        if (address === hop) {
          return [
            transfer({
              transaction_id: "hop-target-same-time",
              from_address: hop,
              to_address: target,
              block_ts: Date.parse("2026-05-05T10:00:00.000Z")
            })
          ];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      amountUsdt: "320000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5
    });

    expect(report.paths.map((path) => path.pathAddresses)).toContainEqual([source, hop, target]);
  });

  it("stores service exposure observations with raw evidence references", async () => {
    const bridge = "TBridge111111111111111111111111111111";
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [transfer({ transaction_id: "source-bridge", from_address: source, to_address: bridge })];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      amountUsdt: "320000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5,
      getAddressMetadata: async (address) => address === bridge
        ? {
            address,
            name: "Allbridge Bridge",
            tag: "Allbridge:Cross-chain Bridge",
            isContract: true,
            verified: true
          }
        : null
    });

    const exposureObservation = report.observations.find((item) => item.code === "forensic_service_exposure");
    expect(report.serviceExposureProfiles[0].exposureScore).toBeGreaterThan(0);
    expect(exposureObservation?.rawEvidenceId).toBeTruthy();
    expect(report.rawEvidence.some((item) => item.id === exposureObservation?.rawEvidenceId)).toBe(true);
  });
});
