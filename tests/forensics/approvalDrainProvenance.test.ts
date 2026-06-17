import { describe, expect, it, vi } from "vitest";
import { buildApprovalDrainProvenanceAnalysis, buildApprovalDrainProvenanceProfile, buildApprovalDrainProvenanceProfiles } from "../../src/forensics/approvalDrainProvenance";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { TronscanApprovalChange } from "../../src/tron/tronClient";

const victim = "TVictim111111111111111111111111111111";
const spender = "TSpender11111111111111111111111111111";
const firstReceiver = "TReceiver1111111111111111111111111111";
const intermediate = "TInter111111111111111111111111111111";
const subject = "TSubject111111111111111111111111111111";
const service = "TRouter111111111111111111111111111111";
const secondVictim = "TVictim222222222222222222222222222222";
const secondSpender = "TSpender22222222222222222222222222222";
const operator = "TOperator1111111111111111111111111111";
const wrapperContract = "TWrapper11111111111111111111111111111";
const markerToken = "TMarker111111111111111111111111111111";

function edge(input: {
  id: string;
  from: string;
  to: string;
  amountRaw: string;
  at: string;
  edgeType?: ForensicRouteEdge["edgeType"];
  method?: string;
}): ForensicRouteEdge {
  return {
    id: input.id,
    fromAddress: input.from,
    toAddress: input.to,
    txHash: input.id,
    amountRaw: input.amountRaw,
    timestamp: new Date(input.at),
    method: input.method ?? (input.edgeType === "transfer_from" ? "transferFrom" : "transfer"),
    edgeType: input.edgeType ?? "normal_transfer"
  };
}

function approval(overrides: Partial<TronscanApprovalChange> = {}): TronscanApprovalChange {
  return {
    txHash: "tx-approval",
    ownerAddress: victim,
    spenderAddress: spender,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "400000000000",
    isUnlimited: false,
    timestamp: new Date("2026-05-09T20:50:00.000Z"),
    confirmed: true,
    contractRet: "SUCCESS",
    ...overrides
  };
}

function deps(overrides: {
  caller?: string | null;
  approvals?: TronscanApprovalChange[];
} = {}) {
  return {
    getTransaction: vi.fn(async () => overrides.caller === null ? {} : { ownerAddress: overrides.caller ?? spender }),
    listTrc20ApprovalChanges: vi.fn(async () => overrides.approvals ?? [approval()]),
    getUsdtRestrictionStatus: vi.fn(async (address: string) => ({
      subjectAddress: address,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      tokenSymbol: "USDT" as const,
      tokenStandard: "TRC20" as const,
      decimals: 6,
      isBlacklisted: false,
      balanceRaw: "0",
      checkedAt: "2026-05-09T21:00:00.000Z",
      evidenceStrength: "exact_contract_state" as const,
      blacklistEventTxHash: null,
      blacklistEventTimestamp: null,
      blacklistEventBlock: null,
      methods: {
        blacklist: "isBlackListed(address)" as const,
        balance: "balanceOf(address)" as const
      }
    }))
  };
}

function boundary(category: ServiceClassification["category"]): ServiceClassification {
  return {
    category,
    identity: null,
    confidence: "high",
    evidence: ["test"],
    isBoundary: true
  };
}

describe("approval-drain provenance", () => {
  it("scores direct first receiver as 90/100", async () => {
    const profile = await buildApprovalDrainProvenanceProfile({
      subjectAddress: firstReceiver,
      edges: [
        edge({
          id: "tx-drain",
          from: victim,
          to: firstReceiver,
          amountRaw: "311851000000",
          at: "2026-05-09T21:00:00.000Z",
          edgeType: "transfer_from"
        })
      ],
      deps: deps({ approvals: [approval({ timestamp: new Date("2026-05-09T10:00:00.000Z") })] })
    });

    expect(profile).toMatchObject({
      subjectAddress: firstReceiver,
      victimAddress: victim,
      spenderAddress: spender,
      firstReceiverAddress: firstReceiver,
      hopDepth: 0,
      score: 90,
      amountPreservationRatio: 1,
      approvalTxHash: "tx-approval",
      drainTxHash: "tx-drain",
      evidenceStrength: "exact_approval_and_transfer_from"
    });
  });

  it("resolves TFagr-style wrapper contracts as the approved spender, not the operator", async () => {
    const lookup = {
      getTransaction: vi.fn(async () => ({
        ownerAddress: operator,
        contractData: {
          contract_address: wrapperContract,
          function_selector: "Verify20(address,address,uint256)"
        },
        trigger_info: {
          methodName: "Verify20"
        },
        trc20TransferInfo: [
          {
            from_address: "TNoise111111111111111111111111111111",
            to_address: victim,
            quant: "1",
            contract_address: markerToken,
            tokenInfo: { tokenAbbr: "BTTOLD", tokenId: markerToken, tokenType: "trc20" }
          },
          {
            from_address: victim,
            to_address: subject,
            quant: "2576000000",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
          }
        ]
      })),
      listTrc20ApprovalChanges: vi.fn(async (input: { ownerAddress: string; spenderAddress: string }) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "5000000000",
          timestamp: new Date("2026-05-09T10:00:00.000Z")
        })
      ]),
      getUsdtRestrictionStatus: vi.fn(async (address: string) => ({
        subjectAddress: address,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT" as const,
        tokenStandard: "TRC20" as const,
        decimals: 6,
        isBlacklisted: false,
        balanceRaw: "0",
        checkedAt: "2026-05-09T21:00:00.000Z",
        evidenceStrength: "exact_contract_state" as const,
        blacklistEventTxHash: null,
        blacklistEventTimestamp: null,
        blacklistEventBlock: null,
        methods: {
          blacklist: "isBlackListed(address)" as const,
          balance: "balanceOf(address)" as const
        }
      }))
    };

    const profiles = await buildApprovalDrainProvenanceProfiles({
      subjectAddress: subject,
      edges: [
        edge({
          id: "tx-wrapper-drain",
          from: victim,
          to: subject,
          amountRaw: "2576000000",
          at: "2026-05-09T21:00:00.000Z",
          method: "Verify20"
        })
      ],
      deps: lookup
    });

    expect(lookup.listTrc20ApprovalChanges).toHaveBeenCalledWith(expect.objectContaining({
      ownerAddress: victim,
      spenderAddress: wrapperContract
    }));
    expect(profiles[0]).toMatchObject({
      victimAddress: victim,
      spenderAddress: wrapperContract,
      operatorAddress: operator,
      spenderResolution: "wrapper_contract",
      score: 90,
      falsePositiveGuards: []
    });
    expect(profiles[0]?.supportingFingerprints).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "misleading_wrapper_method" }),
      expect.objectContaining({ code: "nearby_non_usdt_token_transfer", value: "BTTOLD" })
    ]));
  });

  it("returns multiple direct approval-drain profiles for separate victim branches", async () => {
    const lookup = {
      getTransaction: vi.fn(async (txHash: string) => ({
        ownerAddress: txHash === "tx-drain-1" ? spender : secondSpender
      })),
      listTrc20ApprovalChanges: vi.fn(async (input: { ownerAddress: string; spenderAddress: string }) => [
        approval({
          txHash: `approval-${input.ownerAddress}`,
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "500000000000",
          timestamp: new Date("2026-05-09T10:00:00.000Z")
        })
      ]),
      getUsdtRestrictionStatus: vi.fn(async (address: string) => ({
        subjectAddress: address,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT" as const,
        tokenStandard: "TRC20" as const,
        decimals: 6,
        isBlacklisted: false,
        balanceRaw: "0",
        checkedAt: "2026-05-09T21:00:00.000Z",
        evidenceStrength: "exact_contract_state" as const,
        blacklistEventTxHash: null,
        blacklistEventTimestamp: null,
        blacklistEventBlock: null,
        methods: {
          blacklist: "isBlackListed(address)" as const,
          balance: "balanceOf(address)" as const
        }
      }))
    };

    const profiles = await buildApprovalDrainProvenanceProfiles({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-drain-1", from: victim, to: subject, amountRaw: "311851000000", at: "2026-05-09T21:00:00.000Z", edgeType: "transfer_from" }),
        edge({ id: "tx-drain-2", from: secondVictim, to: subject, amountRaw: "2576000000", at: "2026-05-09T21:01:00.000Z", edgeType: "transfer_from" })
      ],
      deps: lookup,
      maxCandidates: 5
    });

    expect(profiles).toHaveLength(2);
    expect(profiles.map((profile) => profile.victimAddress)).toEqual([victim, secondVictim]);
    expect(profiles.map((profile) => profile.spenderAddress)).toEqual([spender, secondSpender]);
    expect(profiles.every((profile) => profile.score === 90 && profile.hopDepth === 0)).toBe(true);
  });

  it("scores one-hop route-linked subject as 80/100", async () => {
    const profile = await buildApprovalDrainProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-drain", from: victim, to: firstReceiver, amountRaw: "311851000000", at: "2026-05-09T21:00:00.000Z", edgeType: "transfer_from" }),
        edge({ id: "tx-hop", from: firstReceiver, to: subject, amountRaw: "309000000000", at: "2026-05-09T21:05:00.000Z" })
      ],
      deps: deps({ approvals: [approval({ timestamp: new Date("2026-05-09T10:00:00.000Z") })] })
    });

    expect(profile).toMatchObject({
      hopDepth: 1,
      score: 80,
      evidenceStrength: "route_linked",
      pathTxHashes: ["tx-drain", "tx-hop"]
    });
  });

  it("matches merged receiver-to-subject chunks against the larger approval-drain transfer", async () => {
    const profile = await buildApprovalDrainProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-large-drain", from: victim, to: firstReceiver, amountRaw: "320652450320", at: "2026-05-09T10:13:12.000Z", edgeType: "transfer_from" }),
        edge({ id: "tx-small-drain", from: victim, to: firstReceiver, amountRaw: "1300000000", at: "2026-05-09T10:34:00.000Z", edgeType: "transfer_from" }),
        edge({ id: "tx-hop-1", from: firstReceiver, to: subject, amountRaw: "999000000", at: "2026-05-09T21:06:51.000Z" }),
        edge({ id: "tx-hop-2", from: firstReceiver, to: subject, amountRaw: "99999000000", at: "2026-05-09T21:59:18.000Z" }),
        edge({ id: "tx-hop-3", from: firstReceiver, to: subject, amountRaw: "111111000000", at: "2026-05-09T22:52:27.000Z" }),
        edge({ id: "tx-hop-4", from: firstReceiver, to: subject, amountRaw: "99742000000", at: "2026-05-09T23:00:51.000Z" })
      ],
      deps: deps({ approvals: [approval({ timestamp: new Date("2026-05-09T10:00:00.000Z") })] })
    });

    expect(profile).toMatchObject({
      hopDepth: 1,
      score: 80,
      drainTxHash: "tx-large-drain",
      pathTxHashes: ["tx-large-drain", "tx-hop-1", "tx-hop-2", "tx-hop-3", "tx-hop-4"]
    });
    expect(profile?.amountPreservationRatio).toBe(0.9725);
  });

  it("scores two-hop route-linked subject as 70/100", async () => {
    const profile = await buildApprovalDrainProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-drain", from: victim, to: firstReceiver, amountRaw: "311851000000", at: "2026-05-09T21:00:00.000Z", edgeType: "transfer_from" }),
        edge({ id: "tx-hop-1", from: firstReceiver, to: intermediate, amountRaw: "310000000000", at: "2026-05-09T21:02:00.000Z" }),
        edge({ id: "tx-hop-2", from: intermediate, to: subject, amountRaw: "300000000000", at: "2026-05-09T21:03:00.000Z" })
      ],
      deps: deps()
    });

    expect(profile).toMatchObject({
      hopDepth: 2,
      score: 70,
      pathTxHashes: ["tx-drain", "tx-hop-1", "tx-hop-2"]
    });
  });

  it("allows same timestamp ordering", async () => {
    const profile = await buildApprovalDrainProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-drain", from: victim, to: firstReceiver, amountRaw: "100000000000", at: "2026-05-09T21:00:00.000Z", edgeType: "transfer_from" }),
        edge({ id: "tx-hop", from: firstReceiver, to: subject, amountRaw: "100000000000", at: "2026-05-09T21:00:00.000Z" })
      ],
      deps: deps({ approvals: [approval({ timestamp: new Date("2026-05-09T21:00:00.000Z") })] })
    });

    expect(profile?.score).toBe(80);
  });

  it("stops route-linked proof when the first receiver is already a service boundary", async () => {
    await expect(buildApprovalDrainProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-drain", from: victim, to: firstReceiver, amountRaw: "100000000000", at: "2026-05-09T21:00:00.000Z", edgeType: "transfer_from" }),
        edge({ id: "tx-boundary-subject", from: firstReceiver, to: subject, amountRaw: "100000000000", at: "2026-05-09T21:01:00.000Z" })
      ],
      classifications: new Map([[firstReceiver, boundary("cex")]]),
      deps: deps()
    })).resolves.toBeNull();
  });

  it("keeps verified router approval with paired economic output out of exact drain proof", async () => {
    const routerReceiver = "TRouterPool11111111111111111111111111";
    const outputToken = "TOutput111111111111111111111111111111";
    const lookup = {
      getTransaction: vi.fn(async () => ({
        ownerAddress: spender,
        contractAddress: TRON_USDT_CONTRACT_ADDRESS,
        trigger_info: {
          methodName: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"
        },
        trc20TransferInfo: [
          {
            from_address: victim,
            to_address: routerReceiver,
            quant: "100000000000",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
          },
          {
            from_address: routerReceiver,
            to_address: victim,
            quant: "250000000000000000",
            contract_address: outputToken,
            tokenInfo: { tokenAbbr: "SUN", tokenId: outputToken, tokenType: "trc20" }
          }
        ]
      })),
      listTrc20ApprovalChanges: vi.fn(async () => [
        approval({
          spenderAddress: spender,
          amountRaw: "100000000000",
          timestamp: new Date("2026-05-09T20:00:00.000Z")
        })
      ]),
      getUsdtRestrictionStatus: vi.fn()
    };

    const analysis = await buildApprovalDrainProvenanceAnalysis({
      subjectAddress: routerReceiver,
      edges: [
        edge({
          id: "tx-router-swap",
          from: victim,
          to: routerReceiver,
          amountRaw: "100000000000",
          at: "2026-05-09T21:00:00.000Z",
          edgeType: "transfer_from"
        })
      ],
      classifications: new Map([
        [spender, {
          category: "router",
          identity: "SunSwap Router",
          confidence: "high",
          evidence: ["tag:router", "verified_contract"],
          isBoundary: true
        }]
      ]),
      contractProfiles: new Map([[spender, {
        isVerified: true,
        serviceTag: "SunSwap Router",
        topMethods: [{ methodId: "0x", signature: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)", count: 1, ratio: 1 }]
      }]]),
      deps: lookup
    });

    expect(analysis.profiles).toEqual([]);
    expect(analysis.reviewFindings).toEqual([
      expect.objectContaining({
        reason: "service_boundary_guard",
        spenderAddress: spender,
        falsePositiveGuards: expect.arrayContaining([
          expect.objectContaining({
            code: "service_boundary_route",
            address: spender,
            category: "router",
            identity: "SunSwap Router"
          })
        ])
      })
    ]);
  });

  it("does not let an unrelated large second hop fake two-hop amount preservation", async () => {
    await expect(buildApprovalDrainProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-drain", from: victim, to: firstReceiver, amountRaw: "100000000000", at: "2026-05-09T21:00:00.000Z", edgeType: "transfer_from" }),
        edge({ id: "tx-dust-hop", from: firstReceiver, to: intermediate, amountRaw: "1000000", at: "2026-05-09T21:01:00.000Z" }),
        edge({ id: "tx-unrelated-large-hop", from: intermediate, to: subject, amountRaw: "100000000000", at: "2026-05-09T21:02:00.000Z" })
      ],
      deps: deps()
    })).resolves.toBeNull();
  });

  it("does not score the checked subject itself when it is a service boundary", async () => {
    await expect(buildApprovalDrainProvenanceProfile({
      subjectAddress: firstReceiver,
      edges: [
        edge({ id: "tx-drain", from: victim, to: firstReceiver, amountRaw: "100000000000", at: "2026-05-09T21:00:00.000Z", edgeType: "transfer_from" })
      ],
      classifications: new Map([[firstReceiver, boundary("cex")]]),
      deps: deps()
    })).resolves.toBeNull();
  });

  it("rejects non-transferFrom, caller mismatch, late approval, low preservation, and service-boundary continuation", async () => {
    const baseEdges = [
      edge({ id: "tx-drain", from: victim, to: firstReceiver, amountRaw: "100000000000", at: "2026-05-09T21:00:00.000Z", edgeType: "transfer_from" }),
      edge({ id: "tx-hop", from: firstReceiver, to: subject, amountRaw: "100000000000", at: "2026-05-09T21:01:00.000Z" })
    ];

    await expect(buildApprovalDrainProvenanceProfile({
      subjectAddress: subject,
      edges: [edge({ ...baseEdges[0], id: "tx-normal", from: victim, to: firstReceiver, amountRaw: "100000000000", at: "2026-05-09T21:00:00.000Z", edgeType: "normal_transfer" }), baseEdges[1]],
      deps: deps()
    })).resolves.toBeNull();
    await expect(buildApprovalDrainProvenanceProfile({ subjectAddress: subject, edges: baseEdges, deps: deps({ caller: "TOther111111111111111111111111111111" }) })).resolves.toBeNull();
    await expect(buildApprovalDrainProvenanceProfile({ subjectAddress: subject, edges: baseEdges, deps: deps({ approvals: [approval({ timestamp: new Date("2026-05-09T21:02:00.000Z") })] }) })).resolves.toBeNull();
    await expect(buildApprovalDrainProvenanceProfile({
      subjectAddress: subject,
      edges: [baseEdges[0], edge({ id: "tx-dust", from: firstReceiver, to: subject, amountRaw: "1000000", at: "2026-05-09T21:01:00.000Z" })],
      deps: deps()
    })).resolves.toBeNull();
    await expect(buildApprovalDrainProvenanceProfile({
      subjectAddress: subject,
      edges: [
        baseEdges[0],
        edge({ id: "tx-router", from: firstReceiver, to: service, amountRaw: "100000000000", at: "2026-05-09T21:01:00.000Z" }),
        edge({ id: "tx-router-subject", from: service, to: subject, amountRaw: "100000000000", at: "2026-05-09T21:02:00.000Z" })
      ],
      classifications: new Map([[service, boundary("router")]]),
      deps: deps()
    })).resolves.toBeNull();
  });
});
