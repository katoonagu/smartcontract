import { describe, expect, it, vi } from "vitest";
import type { ContractIntelligenceProfile } from "../../src/approvals/contractIntelligence";
import { selectRecentFlowProvenanceTransfers } from "../../src/forensics/recentFlowProvenanceSelection";
import {
  authoritativeRegisteredService,
  classifyServiceAddress
} from "../../src/forensics/serviceClassifier";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { AddressMetadata, WalletApprovalSpenderRelation } from "../../src/storage/repositories";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";
import {
  activeAllowance,
  APPROVAL_TX,
  BRIDGERS,
  NOW,
  OWNER,
  SUBJECT,
  SWAP_TX,
  VERIFY20
} from "../fixtures/forensics/remediationScoringCases";

const GASFREE_ENDPOINT = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
const GASFREE_POOLED_BOUNDARY = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";
const FOREIGN = "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ";

type EvidenceKind =
  | "metadata_context"
  | "official_registry"
  | "gasfree_role"
  | "provider_risk"
  | "verify20_fingerprint"
  | "approval_event"
  | "allowance_read"
  | "exact_debit"
  | "service_action";

type ContractEvidence = {
  id: string;
  kind: EvidenceKind;
  subjectAddress: string;
  spenderAddress: string | null;
  tokenContract: string | null;
};

function metadata(address: string, overrides: Partial<AddressMetadata> = {}): AddressMetadata {
  return {
    address,
    source: "tronscan",
    name: null,
    tag: null,
    isContract: true,
    verified: false,
    accountType: null,
    rawJson: {},
    fetchedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    ...overrides
  };
}

function contractProfile(
  address: string,
  overrides: Partial<ContractIntelligenceProfile> = {}
): ContractIntelligenceProfile {
  return {
    contractAddress: address,
    providerTags: [],
    publicTags: [],
    isVerified: false,
    verifyStatus: null,
    sourceStatus: "missing",
    contractCreatedAt: null,
    contractAgeDays: null,
    txCount: "1",
    recentCallCount: null,
    totalCallCount: "1",
    totalCallerCount: "1",
    topMethods: [],
    topCallers: [],
    methodMap: {},
    providerRisk: false,
    rawPayload: {},
    fetchedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    address,
    source: "tronscan",
    name: null,
    serviceTag: null,
    publicTag: null,
    publicTagDesc: null,
    tagUrl: null,
    verified: false,
    trxCount: "1",
    uniqueCallerCount: "1",
    hasTransferFromSelector: false,
    hasOwnerOnlyPattern: false,
    lowMetadata: true,
    activityLevel: "low",
    rawJson: {},
    ...overrides
  };
}

function evidence(
  id: string,
  kind: EvidenceKind,
  subjectAddress: string,
  spenderAddress: string | null = subjectAddress,
  tokenContract: string | null = TRON_USDT_CONTRACT_ADDRESS
): ContractEvidence {
  return { id, kind, subjectAddress, spenderAddress, tokenContract };
}

function unknownInput(subjectAddress = SUBJECT) {
  return {
    subjectAddress,
    metadata: metadata(subjectAddress),
    serviceClassification: null,
    contractProfile: contractProfile(subjectAddress),
    approvalSafetyAssessments: [],
    evidence: [evidence("metadata:subject", "metadata_context", subjectAddress, null, null)]
  };
}

function officialUsdtInput() {
  return {
    subjectAddress: TRON_USDT_CONTRACT_ADDRESS,
    metadata: metadata(TRON_USDT_CONTRACT_ADDRESS, {
      name: "TetherToken",
      tag: "Official TRON USDT",
      verified: true
    }),
    serviceClassification: null,
    contractProfile: contractProfile(TRON_USDT_CONTRACT_ADDRESS, {
      isVerified: true,
      verified: true,
      lowMetadata: false
    }),
    approvalSafetyAssessments: [],
    evidence: [evidence(
      "registry:official-tron-usdt",
      "official_registry",
      TRON_USDT_CONTRACT_ADDRESS,
      null,
      TRON_USDT_CONTRACT_ADDRESS
    )]
  };
}

function gasFreeStructuralInput() {
  const profile = contractProfile(SUBJECT, {
    providerTags: [{ kind: "greyTag", label: "GasFree Account", url: null }],
    methodMap: {
      "6f21b898": "permitTransfer(address,address,address,uint256,uint256,uint256,uint256,uint256,bytes)"
    }
  });
  const addressMetadata = {
    ...metadata(SUBJECT),
    name: "CreatedByContract",
    accountType: null
  } satisfies AddressMetadata;
  return {
    subjectAddress: SUBJECT,
    metadata: addressMetadata,
    serviceClassification: classifyServiceAddress({
      address: SUBJECT,
      metadata: addressMetadata,
      contractProfile: profile
    }),
    contractProfile: profile,
    approvalSafetyAssessments: []
  };
}

function assessment(spenderAddress: string, overrides: Record<string, unknown> = {}) {
  return {
    version: "approval-safety-v2",
    subjectAddress: OWNER,
    level: "MEDIUM" as const,
    score: 45,
    action: "REVOKE_IF_UNUSED",
    amlScoreImpact: 0,
    allowance: activeAllowance(undefined, spenderAddress),
    balanceAtRiskRaw: null,
    exactVerify20: false,
    exactDebit: false,
    debitFoundFromSubject: false,
    campaignEvidenceIds: [`allowance:${spenderAddress}`],
    serviceSession: null,
    authoritativeServiceId: null,
    providerRisk: false,
    ...overrides
  };
}

function bridgersSession() {
  return {
    walletAddress: OWNER,
    spenderAddress: BRIDGERS,
    approvalTxHash: APPROVAL_TX,
    actionTxHash: SWAP_TX,
    actionKind: "swap",
    walletInitiated: true,
    successful: true,
    delayMs: 66_000,
    approvedAmountRaw: activeAllowance(undefined, BRIDGERS).confirmedAllowanceRaw,
    movedAmountRaw: "91103009",
    amountContinuity: "exact",
    authoritativeServiceId: "bridgers"
  };
}

function bridgersClassification(): ServiceClassification {
  return {
    category: "bridge",
    identity: "Bridgers:Cross-chain Bridge",
    confidence: "high",
    evidence: ["registry:bridgers"],
    isBoundary: true
  };
}

function boundAssessmentEvidence(subjectAddress: string, campaign: ContractEvidence[] = []): ContractEvidence[] {
  return [
    evidence(APPROVAL_TX, "approval_event", subjectAddress),
    evidence(`allowance:${subjectAddress}`, "allowance_read", subjectAddress),
    ...campaign
  ];
}

function bridgersInput(withSession: boolean) {
  const session = withSession ? bridgersSession() : null;
  const registryId = "registry:bridgers";
  const allowanceId = `allowance:${BRIDGERS}`;
  return {
    subjectAddress: BRIDGERS,
    metadata: metadata(BRIDGERS, {
      name: "Bridgers",
      tag: "Bridgers:Cross-chain Bridge",
      verified: true
    }),
    serviceClassification: bridgersClassification(),
    contractProfile: contractProfile(BRIDGERS, {
      isVerified: true,
      verified: true,
      lowMetadata: false,
      serviceTag: "Bridgers:Cross-chain Bridge",
      providerTags: [{ kind: "blueTag", label: "Bridgers:Cross-chain Bridge", url: null }]
    }),
    approvalSafetyAssessments: [assessment(BRIDGERS, {
      level: withSession ? "LOW" : "MEDIUM",
      score: withSession ? 10 : 45,
      campaignEvidenceIds: withSession ? [allowanceId] : [allowanceId, registryId],
      serviceSession: session,
      authoritativeServiceId: "bridgers"
    })],
    evidence: [
      evidence(APPROVAL_TX, "approval_event", BRIDGERS),
      evidence(allowanceId, "allowance_read", BRIDGERS),
      ...(withSession ? [evidence(SWAP_TX, "service_action", BRIDGERS)] : []),
      ...(!withSession ? [evidence(registryId, "official_registry", BRIDGERS)] : [])
    ]
  };
}

function exactAssessmentInput(
  subjectAddress: string,
  kind: "verify20_fingerprint" | "exact_debit",
  wrongKind?: EvidenceKind
) {
  const proofId = `proof:${kind}`;
  const exactVerify20 = kind === "verify20_fingerprint";
  return {
    ...unknownInput(subjectAddress),
    approvalSafetyAssessments: [assessment(subjectAddress, {
      level: "CRITICAL",
      score: exactVerify20 ? 90 : 95,
      action: "REVOKE_NOW",
      exactVerify20,
      exactDebit: !exactVerify20,
      debitFoundFromSubject: !exactVerify20,
      campaignEvidenceIds: [`allowance:${subjectAddress}`, proofId]
    })],
    evidence: [
      ...boundAssessmentEvidence(subjectAddress),
      evidence(proofId, wrongKind ?? kind, subjectAddress),
      evidence("metadata:subject", "metadata_context", subjectAddress, null, null)
    ]
  };
}

type ContractAcceptanceInput = {
  subjectAddress: string;
  metadata: AddressMetadata;
  serviceClassification: ServiceClassification | null;
  contractProfile: ContractIntelligenceProfile;
  approvalSafetyAssessments: Array<ReturnType<typeof assessment>>;
  evidence?: ContractEvidence[];
};

type SmartContractAcceptanceResult = {
  subjectAddress: string;
  llmVerdict: unknown;
  contractDecisionV2?: {
    finalSource: string;
    llm: unknown;
    deterministic?: {
      score: number;
      level: string;
      decision: string;
      authority: string;
      evidenceIds: string[];
    };
  };
};

async function resolve(input: Record<string, unknown>) {
  const target = await vi.importActual<Record<string, unknown>>(
    "../../src/forensics/contractDecision"
  );
  expect(target.resolveContractDecisionV2).toBeTypeOf("function");
  return (target.resolveContractDecisionV2 as (value: Record<string, unknown>) => any)(input);
}

async function buildContractEvidence(input: ContractAcceptanceInput): Promise<ContractEvidence[]> {
  const target = await vi.importActual<Record<string, unknown>>(
    "../../src/forensics/contractDecision"
  );
  expect(target.buildContractDecisionEvidenceV1).toBeTypeOf("function");
  return (target.buildContractDecisionEvidenceV1 as (value: ContractAcceptanceInput) => ContractEvidence[])(input);
}

function relatedApprovalsFor(input: ContractAcceptanceInput): WalletApprovalSpenderRelation[] {
  return input.approvalSafetyAssessments.map((item, index) => ({
    watchedWalletId: `acceptance-wallet-${index}`,
    tokenContract: item.allowance.tokenContract,
    spenderAddress: item.allowance.spenderAddress,
    amountRaw: item.allowance.confirmedAllowanceRaw ?? "0",
    isUnlimited: item.allowance.isUnlimited === true,
    currentAllowanceRaw: item.allowance.confirmedAllowanceRaw ?? "0",
    spenderType: "contract",
    status: item.allowance.state === "confirmed_active" ? "active" : "revoked",
    lastApprovalTxHash: item.allowance.observedApprovalTxHash,
    lastApprovalAt: item.allowance.confirmedAt ? new Date(item.allowance.confirmedAt) : null,
    riskLevel: item.level,
    riskScore: item.score,
    riskReasons: [],
    lastAlertedTxHash: null,
    metadataName: input.metadata?.name ?? null,
    metadataTag: input.metadata?.tag ?? null,
    metadataSource: "tronscan",
    metadataIsContract: input.metadata?.isContract ?? null,
    contractServiceTag: input.contractProfile?.serviceTag ?? null,
    contractVerified: input.contractProfile?.verified ?? null,
    contractActivityLevel: input.contractProfile?.activityLevel ?? null,
    contractTopMethods: input.contractProfile?.topMethods ?? [],
    contractHasTransferFromSelector: input.contractProfile?.hasTransferFromSelector ?? null,
    contractHasOwnerOnlyPattern: input.contractProfile?.hasOwnerOnlyPattern ?? null,
    updatedAt: NOW,
    watchedWalletAddress: item.subjectAddress ?? OWNER,
    watchedWalletTelegramUserId: "acceptance-user"
  }));
}

async function runSmartContractOrchestration(
  input: ContractAcceptanceInput,
  analyzeContractLlmCaseFiles: (caseFiles: unknown[]) => Promise<unknown[]>
): Promise<SmartContractAcceptanceResult> {
  const target = await vi.importActual<Record<string, unknown>>("../../src/check/smartContractCheck");
  expect(target.checkSmartContractAddress).toBeTypeOf("function");
  return (target.checkSmartContractAddress as (value: Record<string, unknown>) => Promise<SmartContractAcceptanceResult>)({
    address: input.subjectAddress,
    metadata: input.metadata,
    contractProfile: input.contractProfile,
    serviceClassification: input.serviceClassification,
    relatedApprovals: relatedApprovalsFor(input),
    approvalSafetyAssessments: input.approvalSafetyAssessments,
    contractDecisionEvidence: input.evidence,
    analyzeContractLlmCaseFiles
  });
}

function expectFresh(result: any): void {
  expect(result).toMatchObject({ finalSource: "deterministic", llm: null });
  expect(result.deterministic.evidenceIds.length).toBeGreaterThan(0);
}

function automaticModelSpies() {
  const flash = vi.fn(async (_caseFiles: unknown[]) => { throw new Error("Flash must not run"); });
  const proCache = vi.fn(async (_caseFiles: unknown[]) => { throw new Error("Pro/cache must not run"); });
  const analyzeContractLlmCaseFiles = vi.fn(async (caseFiles: unknown[]) => {
    await Promise.all([flash(caseFiles), proCache(caseFiles)]);
    return [];
  });
  return { flash, proCache, analyzeContractLlmCaseFiles };
}

describe("ContractDecisionV2 acceptance contract", () => {
  it("[AC-29] resolves official TRON USDT at LOW 0 without LLM", async () => {
    const spies = automaticModelSpies();
    const orchestration = await runSmartContractOrchestration(
      officialUsdtInput(),
      spies.analyzeContractLlmCaseFiles
    );

    expect.soft(spies.flash).not.toHaveBeenCalled();
    expect.soft(spies.proCache).not.toHaveBeenCalled();
    expect.soft(spies.analyzeContractLlmCaseFiles).not.toHaveBeenCalled();
    expect.soft(orchestration).toMatchObject({
      contractDecisionV2: {
        finalSource: "deterministic",
        llm: null,
        deterministic: {
          score: 0,
          level: "LOW",
          decision: "ACCEPTABLE",
          authority: "official_registry",
          evidenceIds: ["registry:official-tron-usdt"]
        }
      }
    });

    const result = await resolve(officialUsdtInput());

    expect(result.deterministic).toMatchObject({
      score: 0,
      level: "LOW",
      decision: "ACCEPTABLE",
      authority: "official_registry",
      evidenceIds: ["registry:official-tron-usdt"]
    });
    expectFresh(result);
  });

  it("[AC-30] resolves GasFree Account at LOW 10 without LLM and keeps flows eligible", async () => {
    const exactGasFree = gasFreeStructuralInput();
    const spies = automaticModelSpies();
    const orchestration = await runSmartContractOrchestration(
      exactGasFree,
      spies.analyzeContractLlmCaseFiles
    );

    expect.soft(spies.flash).not.toHaveBeenCalled();
    expect.soft(spies.proCache).not.toHaveBeenCalled();
    expect.soft(spies.analyzeContractLlmCaseFiles).not.toHaveBeenCalled();
    expect.soft(orchestration).toMatchObject({
      contractDecisionV2: {
        finalSource: "deterministic",
        llm: null,
        deterministic: {
          score: 10,
          level: "LOW",
          decision: "ACCEPTABLE",
          authority: "gasfree_account",
          evidenceIds: ["role:gasfree_account"]
        }
      }
    });

    expect(exactGasFree.metadata).toMatchObject({
      name: "CreatedByContract",
      accountType: null
    });
    expect(exactGasFree.contractProfile).toMatchObject({
      providerTags: [{ kind: "greyTag", label: "GasFree Account", url: null }],
      methodMap: {
        "6f21b898": "permitTransfer(address,address,address,uint256,uint256,uint256,uint256,uint256,bytes)"
      }
    });
    const builtEvidence = await buildContractEvidence(exactGasFree);
    expect(builtEvidence).toContainEqual({
      id: "role:gasfree_account",
      kind: "gasfree_role",
      subjectAddress: SUBJECT,
      spenderAddress: null,
      tokenContract: null
    });
    expect(builtEvidence.every((item) => item.subjectAddress === SUBJECT)).toBe(true);
    const result = await resolve({ ...exactGasFree, evidence: builtEvidence });
    const principal: ForensicRouteEdge = {
      id: "gasfree-principal",
      txHash: "gasfree-principal-tx",
      fromAddress: OWNER,
      toAddress: SUBJECT,
      amountRaw: "97000000",
      timestamp: NOW,
      method: "permitTransfer",
      edgeType: "transfer_from",
      economicRole: "principal",
      economicProtocol: "tron_gasfree"
    };
    const selection = await selectRecentFlowProvenanceTransfers({
      subjectAddress: SUBJECT,
      currentBalanceRaw: "0",
      edges: [principal]
    });

    expect(result.deterministic).toMatchObject({
      score: 10,
      level: "LOW",
      decision: "ACCEPTABLE",
      authority: "gasfree_account",
      evidenceIds: ["role:gasfree_account"]
    });
    expectFresh(result);
    expect(selection.recentFlowPrincipalTransfers).toEqual([
      expect.objectContaining({ txHash: principal.txHash, economicRole: "principal" })
    ]);

    const labelMetadata = {
      ...metadata(SUBJECT),
      tag: "GasFree Account"
    } satisfies AddressMetadata;
    const labelProfile = contractProfile(SUBJECT, {
      providerTags: [{ kind: "greyTag", label: "GasFree Account", url: null }]
    });
    const labelClassification = classifyServiceAddress({
      address: SUBJECT,
      metadata: labelMetadata,
      contractProfile: labelProfile
    });
    const labelEvidence = await buildContractEvidence({
      subjectAddress: SUBJECT,
      metadata: labelMetadata,
      contractProfile: labelProfile,
      serviceClassification: labelClassification,
      approvalSafetyAssessments: []
    });
    expect(labelEvidence.some((item) => item.kind === "gasfree_role")).toBe(false);
    const labelOnly = await resolve({
      ...unknownInput(),
      metadata: labelMetadata,
      contractProfile: labelProfile,
      serviceClassification: labelClassification,
      evidence: labelEvidence
    });
    expect(labelOnly.deterministic).toMatchObject({ score: 35, decision: "REVIEW", authority: "context" });
    expect(labelOnly.deterministic).not.toMatchObject({ score: 10, authority: "gasfree_account" });

    const fabricatedRoleOnly = await resolve({
      ...unknownInput(),
      evidence: [
        evidence("metadata:subject", "metadata_context", SUBJECT, null, null),
        evidence("role:gasfree_account", "gasfree_role", SUBJECT, null, null)
      ]
    });
    expect(fabricatedRoleOnly.deterministic).toMatchObject({ score: 35, decision: "REVIEW", authority: "context" });
    expect(fabricatedRoleOnly.deterministic).not.toMatchObject({ score: 10, authority: "gasfree_account" });
  });

  it("[REQ-24][GASFREE-BOUNDARY] never classifies a GasFree endpoint or controller as ordinary GasFree Account LOW 10", async () => {
    const endpointMetadata = {
      ...metadata(GASFREE_ENDPOINT),
      name: "UpgradableProxy",
      tag: "GasFree Endpoint"
    } satisfies AddressMetadata;
    const pooledBoundaryMetadata = {
      ...metadata(GASFREE_POOLED_BOUNDARY)
    } satisfies AddressMetadata;
    const cases = [
      {
        address: GASFREE_ENDPOINT,
        addressMetadata: endpointMetadata,
        profile: contractProfile(GASFREE_ENDPOINT, {
          providerTags: [
            { kind: "tag1", label: "GasFree Endpoint", url: null },
            { kind: "blueTag", label: "GasFree", url: "gasfree.io" }
          ],
          methodMap: {
            "6f21b898": "permitTransfer(address,address,address,uint256,uint256,uint256,uint256,uint256,bytes)"
          }
        }),
        expectedEvidence: "registry:gasfree_controller",
        expectedStructuralRole: "role:gasfree_endpoint",
        authoritativeRegistry: true
      },
      {
        address: GASFREE_POOLED_BOUNDARY,
        addressMetadata: pooledBoundaryMetadata,
        profile: contractProfile(GASFREE_POOLED_BOUNDARY),
        expectedEvidence: "registry:tronlink_gasfree_provider",
        expectedStructuralRole: null
      }
    ];

    const classifiedCases = cases.map((item) => {
      const classification = classifyServiceAddress({
        address: item.address,
        metadata: item.addressMetadata,
        contractProfile: item.profile
      });
      expect(classification).toMatchObject({ category: "service", isBoundary: true });
      if (item.expectedStructuralRole) {
        expect(classification.evidence).toContain(item.expectedStructuralRole);
      }
      return { ...item, classification };
    });

    for (const item of classifiedCases) {
      const builtEvidence = await buildContractEvidence({
        subjectAddress: item.address,
        metadata: item.addressMetadata,
        serviceClassification: item.classification,
        contractProfile: item.profile,
        approvalSafetyAssessments: []
      });
      if (item.expectedStructuralRole) {
        expect(builtEvidence).toContainEqual({
          id: item.expectedStructuralRole,
          kind: "gasfree_role",
          subjectAddress: item.address,
          spenderAddress: null,
          tokenContract: null
        });
      }
      expect(builtEvidence).toContainEqual({
        id: item.expectedEvidence,
        kind: "official_registry",
        subjectAddress: item.address,
        spenderAddress: null,
        tokenContract: null
      });
      if (item.authoritativeRegistry) {
        expect(authoritativeRegisteredService(item.address)).toEqual({
          identity: "GasFree Endpoint",
          evidence: "registry:gasfree_controller"
        });
      } else {
        expect(authoritativeRegisteredService(item.address)).toEqual({
          identity: "TronLink GasFree provider",
          evidence: "registry:tronlink_gasfree_provider"
        });
      }
      const result = await resolve({
        subjectAddress: item.address,
        metadata: item.addressMetadata,
        serviceClassification: item.classification,
        contractProfile: item.profile,
        approvalSafetyAssessments: [],
        evidence: builtEvidence
      });
      expect(result?.deterministic).not.toMatchObject({
        score: 10,
        level: "LOW",
        authority: "gasfree_account"
      });
      if (result) {
        expectFresh(result);
        expect(result.deterministic.evidenceIds).toContain(item.expectedEvidence);
      }
    }
  });

  it("[REQ-24][GASFREE-LABEL-ONLY] keeps a controller label as context without LOW 10 authority", async () => {
    const addressMetadata = {
      ...metadata(FOREIGN),
      tag: "GasFree Controller"
    } satisfies AddressMetadata;
    const profile = contractProfile(FOREIGN, {
      providerTags: [{ kind: "tag1", label: "GasFree Controller", url: null }]
    });
    const labelClassification = classifyServiceAddress({
      address: FOREIGN,
      metadata: addressMetadata,
      contractProfile: profile
    });
    expect(labelClassification.evidence).toContain("role:gasfree_endpoint");
    expect(labelClassification.evidence).not.toContain("registry:gasfree_controller");

    const builtEvidence = await buildContractEvidence({
      subjectAddress: FOREIGN,
      metadata: addressMetadata,
      serviceClassification: labelClassification,
      contractProfile: profile,
      approvalSafetyAssessments: []
    });
    expect(builtEvidence).toContainEqual({
      id: "metadata:subject",
      kind: "metadata_context",
      subjectAddress: FOREIGN,
      spenderAddress: null,
      tokenContract: null
    });
    expect(builtEvidence.some((item) => item.kind === "gasfree_role" || item.kind === "official_registry")).toBe(false);

    const result = await resolve({
      subjectAddress: FOREIGN,
      metadata: addressMetadata,
      serviceClassification: labelClassification,
      contractProfile: profile,
      approvalSafetyAssessments: [],
      evidence: builtEvidence
    });
    expect(result.deterministic).toMatchObject({ score: 35, decision: "REVIEW", authority: "context" });
    expect(result.deterministic).not.toMatchObject({ score: 10, authority: "gasfree_account" });
  });

  it("[AC-31] keeps exact Bridgers approval session LOW instead of decline", async () => {
    const result = await resolve(bridgersInput(true));

    expect(result.deterministic).toMatchObject({
      score: 10,
      level: "LOW",
      decision: "ACCEPTABLE",
      authority: "known_service_session",
      evidenceIds: expect.arrayContaining([APPROVAL_TX, SWAP_TX, `allowance:${BRIDGERS}`])
    });
    expectFresh(result);
  });

  it("[AC-31][SMART-BINDING] carries an exact Bridgers session through the Smart entrypoint", async () => {
    const spies = automaticModelSpies();
    const report = await runSmartContractOrchestration(bridgersInput(true), spies.analyzeContractLlmCaseFiles);

    expect(report.contractDecisionV2?.deterministic).toMatchObject({
      score: 10,
      decision: "ACCEPTABLE",
      authority: "known_service_session"
    });
    expect(spies.analyzeContractLlmCaseFiles).not.toHaveBeenCalled();
  });

  it("[AC-31][AC-32][SERVICE-REGISTRY] derives Bridgers authority from the exact spender address only", async () => {
    const bridgersMetadata = metadata(BRIDGERS, {
      name: "Bridgers",
      tag: "Bridgers:Cross-chain Bridge",
      verified: true
    });
    const bridgersProfile = contractProfile(BRIDGERS, {
      isVerified: true,
      verified: true,
      lowMetadata: false,
      serviceTag: "Bridgers:Cross-chain Bridge",
      providerTags: [{ kind: "blueTag", label: "Bridgers:Cross-chain Bridge", url: null }]
    });
    const classification = classifyServiceAddress({
      address: BRIDGERS,
      metadata: bridgersMetadata,
      contractProfile: bridgersProfile
    });
    expect(classification.evidence).not.toContain("registry:bridgers");

    for (const withSession of [true, false]) {
      const approvalSafetyAssessments = bridgersInput(withSession).approvalSafetyAssessments;
      const structuralEvidence = await buildContractEvidence({
        subjectAddress: BRIDGERS,
        metadata: bridgersMetadata,
        contractProfile: bridgersProfile,
        serviceClassification: classification,
        approvalSafetyAssessments
      });
      expect(structuralEvidence.filter((row) => row.id === "registry:bridgers")).toEqual([{
        id: "registry:bridgers",
        kind: "official_registry",
        subjectAddress: BRIDGERS,
        spenderAddress: null,
        tokenContract: null
      }]);
      const contractDecisionEvidence = [
        ...structuralEvidence,
        evidence(APPROVAL_TX, "approval_event", BRIDGERS),
        evidence(`allowance:${BRIDGERS}`, "allowance_read", BRIDGERS),
        ...(withSession ? [evidence(SWAP_TX, "service_action", BRIDGERS)] : [])
      ];
      const spies = automaticModelSpies();
      const report = await runSmartContractOrchestration({
        subjectAddress: BRIDGERS,
        metadata: bridgersMetadata,
        contractProfile: bridgersProfile,
        serviceClassification: classification,
        approvalSafetyAssessments,
        evidence: contractDecisionEvidence
      }, spies.analyzeContractLlmCaseFiles);
      expect(report.contractDecisionV2?.deterministic).toMatchObject(withSession
        ? { score: 10, decision: "ACCEPTABLE", authority: "known_service_session" }
        : { score: 45, decision: "REVIEW", authority: "official_registry" });
      expect(spies.analyzeContractLlmCaseFiles).not.toHaveBeenCalled();
    }

    const foreignMetadata = metadata(FOREIGN, {
      name: "Bridgers",
      tag: "Bridgers:Cross-chain Bridge",
      verified: true
    });
    const foreignProfile = contractProfile(FOREIGN, {
      isVerified: true,
      verified: true,
      lowMetadata: false,
      serviceTag: "Bridgers:Cross-chain Bridge"
    });
    const foreignClassification = classifyServiceAddress({
      address: FOREIGN,
      metadata: foreignMetadata,
      contractProfile: foreignProfile
    });
    const foreignEvidence = await buildContractEvidence({
      subjectAddress: FOREIGN,
      metadata: foreignMetadata,
      contractProfile: foreignProfile,
      serviceClassification: foreignClassification,
      approvalSafetyAssessments: []
    });
    expect(foreignEvidence.some((row) => row.kind === "official_registry")).toBe(false);
  });

  it("[REQ-08][SMART-BINDING] carries exact debit proof through the Smart entrypoint", async () => {
    const spies = automaticModelSpies();
    const report = await runSmartContractOrchestration(
      exactAssessmentInput(SUBJECT, "exact_debit"),
      spies.analyzeContractLlmCaseFiles
    );

    expect(report.contractDecisionV2?.deterministic).toMatchObject({
      score: 95,
      decision: "DECLINE",
      authority: "exact_debit"
    });
    expect(spies.analyzeContractLlmCaseFiles).not.toHaveBeenCalled();
  });

  it("[AC-31][ALLOWANCE-BINDING] rejects a service session without resolved allowance_read evidence", async () => {
    const input = bridgersInput(true);
    const result = await resolve({
      ...input,
      approvalSafetyAssessments: [{
        ...input.approvalSafetyAssessments[0],
        allowance: { ...input.approvalSafetyAssessments[0].allowance, state: "failed" }
      }],
      evidence: [
        ...input.evidence.filter((row) => row.kind !== "allowance_read"),
        evidence("metadata:subject", "metadata_context", BRIDGERS, null, null)
      ]
    });

    expect(result.deterministic).toMatchObject({ score: 35, decision: "REVIEW", authority: "context" });
  });

  it("[AC-32] keeps known-service unlimited approval without session at REVIEW 45", async () => {
    const result = await resolve(bridgersInput(false));

    expect(result.deterministic).toMatchObject({
      score: 45,
      level: "MEDIUM",
      decision: "REVIEW",
      authority: "official_registry",
      evidenceIds: expect.arrayContaining(["registry:bridgers", `allowance:${BRIDGERS}`])
    });
    expect(result.deterministic.decision).not.toBe("DECLINE");
    expectFresh(result);
  });

  it("[AC-33] prevents service-context dampening of provider risk Verify20 or debit proof", async () => {
    const verifyProfile = contractProfile(VERIFY20, {
      methodMap: {
        "5082dd12": "Verify20(address,address,address,uint256)",
        "fc61dd23": "Verify10(address,uint256)",
        "ea4418d9": "withdrawAllTrxTo(address)",
        "f2fde38b": "transferOwnership(address)"
      }
    });
    const benignService: ServiceClassification = {
      category: "service",
      identity: "Known benign service",
      confidence: "high",
      evidence: ["registry:benign-service"],
      isBoundary: true
    };
    const cases = [
      {
        label: "provider risk",
        input: {
          ...unknownInput(SUBJECT),
          serviceClassification: benignService,
          contractProfile: contractProfile(SUBJECT, { providerRisk: true }),
          evidence: [
            evidence("risk:provider", "provider_risk", SUBJECT),
            evidence("registry:benign-service", "official_registry", SUBJECT)
          ]
        },
        score: 90,
        authority: "provider_risk"
      },
      {
        label: "Verify20",
        input: {
          ...exactAssessmentInput(VERIFY20, "verify20_fingerprint"),
          serviceClassification: benignService,
          contractProfile: verifyProfile,
          evidence: [
            ...exactAssessmentInput(VERIFY20, "verify20_fingerprint").evidence,
            evidence("registry:benign-service", "official_registry", VERIFY20)
          ]
        },
        score: 90,
        authority: "verify20_fingerprint"
      },
      {
        label: "exact debit",
        input: {
          ...exactAssessmentInput(SUBJECT, "exact_debit"),
          serviceClassification: benignService,
          evidence: [
            ...exactAssessmentInput(SUBJECT, "exact_debit").evidence,
            evidence("registry:benign-service", "official_registry", SUBJECT)
          ]
        },
        score: 95,
        authority: "exact_debit"
      }
    ];

    for (const item of cases) {
      const result = await resolve(item.input);
      expect(result.deterministic, item.label).toMatchObject({
        score: item.score,
        level: "CRITICAL",
        decision: "DECLINE",
        authority: item.authority
      });
      expectFresh(result);
    }
  });

  it("[REQ-24][CONTRACT-UNKNOWN] resolves unknown metadata without exact bad or service proof at REVIEW 35", async () => {
    const result = await resolve(unknownInput());

    expect(result.deterministic).toEqual({
      score: 35,
      level: "MEDIUM",
      decision: "REVIEW",
      authority: "context",
      evidenceIds: ["metadata:subject"]
    });
    expect(result.deterministic.decision).not.toBe("DECLINE");
    expectFresh(result);
  });

  it("[REQ-08][CONTRACT-EVIDENCE] refuses exact debit authority without exact_debit evidence kind", async () => {
    const wrongKind = await resolve(exactAssessmentInput(SUBJECT, "exact_debit", "approval_event"));
    const unresolvedInput = exactAssessmentInput(SUBJECT, "exact_debit");
    unresolvedInput.approvalSafetyAssessments[0].campaignEvidenceIds.push("fabricated:debit");
    const unresolved = await resolve(unresolvedInput);

    for (const result of [wrongKind, unresolved]) {
      expect(result.deterministic).toMatchObject({
        score: 35,
        decision: "REVIEW",
        authority: "context"
      });
      expect(result.deterministic.score).not.toBe(95);
      expect(result.deterministic.evidenceIds).toEqual(["metadata:subject"]);
    }
  });

  it("[REQ-08][CONTRACT-EVIDENCE] refuses Verify20 authority without verify20_fingerprint evidence kind", async () => {
    const wrongKinds: EvidenceKind[] = ["approval_event", "allowance_read", "provider_risk"];
    for (const wrongKind of wrongKinds) {
      const result = await resolve(exactAssessmentInput(VERIFY20, "verify20_fingerprint", wrongKind));
      expect(result.deterministic).toMatchObject({
        score: 35,
        decision: "REVIEW",
        authority: "context"
      });
      expect(result.deterministic.score).not.toBe(90);
      expect(result.deterministic.evidenceIds).toEqual(["metadata:subject"]);
    }
  });

  it("[REQ-08][CONTRACT-EVIDENCE] refuses duplicate or mixed-kind direct proof IDs", async () => {
    const providerInput = {
      ...unknownInput(),
      contractProfile: contractProfile(SUBJECT, { providerRisk: true }),
      evidence: [
        evidence("risk:provider", "provider_risk", SUBJECT),
        evidence("risk:provider", "metadata_context", SUBJECT, null, null),
        evidence("metadata:subject", "metadata_context", SUBJECT, null, null)
      ]
    };
    const gasFreeInput = gasFreeStructuralInput();
    const gasFreeEvidence = await buildContractEvidence(gasFreeInput);
    const gasFreeResult = await resolve({
      ...gasFreeInput,
      evidence: [
        ...gasFreeEvidence,
        evidence("role:gasfree_account", "metadata_context", SUBJECT, null, null)
      ]
    });

    expect((await resolve(providerInput)).deterministic).toMatchObject({ score: 35, authority: "context" });
    expect(gasFreeResult.deterministic).toMatchObject({ score: 35, authority: "context" });
  });

  it("[REQ-08][SMART-BINDING] fails closed when the explicit evidence set cannot bind a decision", async () => {
    const spies = automaticModelSpies();
    await expect(runSmartContractOrchestration(
      { ...unknownInput(), evidence: [] },
      spies.analyzeContractLlmCaseFiles
    )).rejects.toThrow("contract_decision_binding_failed");
    expect(spies.analyzeContractLlmCaseFiles).not.toHaveBeenCalled();
  });

  it("[REQ-24][CONTRACT-UNKNOWN] requires subject-bound metadata_context for REVIEW 35", async () => {
    const base = unknownInput();
    const cases = [
      [],
      [evidence("metadata:foreign", "metadata_context", FOREIGN, null, null)],
      [evidence("metadata:wrong-kind", "approval_event", SUBJECT, null, null)]
    ];

    for (const currentEvidence of cases) {
      const result = await resolve({ ...base, evidence: currentEvidence });
      expect(result).toBeNull();
      expect(currentEvidence.map((item) => item.id)).not.toContain("metadata:subject");
    }
  });

  it("[REQ-05][REQ-21][CONTRACT-SUBJECT] ignores foreign approval or service-session assessments", async () => {
    const valid = exactAssessmentInput(SUBJECT, "exact_debit");
    const baseAssessment = valid.approvalSafetyAssessments[0];
    const baseEvidence = valid.evidence;
    const emptyAllowance = { ...activeAllowance(undefined, SUBJECT), observedApprovalTxHash: null };
    const cases = [
      {
        label: "wrong spender",
        assessment: { ...baseAssessment, allowance: activeAllowance(undefined, FOREIGN) },
        evidence: baseEvidence
      },
      {
        label: "non-USDT token",
        assessment: {
          ...baseAssessment,
          allowance: { ...activeAllowance(undefined, SUBJECT), tokenContract: FOREIGN }
        },
        evidence: baseEvidence
      },
      {
        label: "foreign evidence",
        assessment: baseAssessment,
        evidence: baseEvidence.map((item) => item.id === "proof:exact_debit"
          ? { ...item, subjectAddress: FOREIGN }
          : item)
      },
      {
        label: "empty evidence",
        assessment: { ...baseAssessment, allowance: emptyAllowance, campaignEvidenceIds: [] },
        evidence: [evidence("metadata:subject", "metadata_context", SUBJECT, null, null)]
      },
      {
        label: "unresolved evidence",
        assessment: { ...baseAssessment, campaignEvidenceIds: ["unresolved:proof"] },
        evidence: baseEvidence
      },
      {
        label: "duplicate assessment evidence id",
        assessment: {
          ...baseAssessment,
          campaignEvidenceIds: [
            ...baseAssessment.campaignEvidenceIds,
            baseAssessment.campaignEvidenceIds[0]
          ]
        },
        evidence: baseEvidence
      },
      {
        label: "multiply resolved evidence id",
        assessment: baseAssessment,
        evidence: [
          ...baseEvidence,
          { ...baseEvidence.find((item) => item.id === "proof:exact_debit")! }
        ]
      },
      {
        label: "other assessment subject",
        assessment: { ...baseAssessment, subjectAddress: FOREIGN },
        evidence: baseEvidence
      },
      {
        label: "foreign service session",
        assessment: bridgersInput(true).approvalSafetyAssessments[0],
        evidence: [...baseEvidence, ...bridgersInput(true).evidence]
      }
    ];

    for (const item of cases) {
      const result = await resolve({
        ...unknownInput(),
        approvalSafetyAssessments: [item.assessment],
        evidence: item.evidence
      });
      expect(result.deterministic, item.label).toEqual({
        score: 35,
        level: "MEDIUM",
        decision: "REVIEW",
        authority: "context",
        evidenceIds: ["metadata:subject"]
      });
    }
  });

  it("[AC-40] bypasses Flash and Pro for every fresh contract case", async () => {
    const spies = automaticModelSpies();
    const providerRisk = {
      ...unknownInput(SUBJECT),
      contractProfile: contractProfile(SUBJECT, { providerRisk: true }),
      evidence: [evidence("risk:provider", "provider_risk", SUBJECT)]
    };
    const cases = [
      ["official USDT", officialUsdtInput()],
      ["GasFree Account", gasFreeStructuralInput()],
      ["Bridgers session", bridgersInput(true)],
      ["known service", bridgersInput(false)],
      ["Verify20", exactAssessmentInput(VERIFY20, "verify20_fingerprint")],
      ["provider risk", providerRisk],
      ["exact debit", exactAssessmentInput(SUBJECT, "exact_debit")],
      ["unknown", unknownInput()],
      ["ambiguous", {
        ...unknownInput(),
        metadata: metadata(SUBJECT, { name: "Maybe Router", tag: "Ambiguous contract metadata" }),
        contractProfile: contractProfile(SUBJECT, { name: "Maybe Router", lowMetadata: true })
      }]
    ] as const;

    for (const [label, input] of cases) {
      const result = await runSmartContractOrchestration(input, spies.analyzeContractLlmCaseFiles);
      expect.soft(result.subjectAddress, label).toBe(input.subjectAddress);
      expect.soft(result.llmVerdict, label).toBeNull();
      expect.soft(result.contractDecisionV2, label).toMatchObject({
        finalSource: "deterministic",
        llm: null
      });
      if (label === "unknown" || label === "ambiguous") {
        expect.soft(result.contractDecisionV2?.deterministic, label).toEqual({
          score: 35,
          level: "MEDIUM",
          decision: "REVIEW",
          authority: "context",
          evidenceIds: ["metadata:subject"]
        });
      }
    }
    expect(spies.flash).not.toHaveBeenCalled();
    expect(spies.proCache).not.toHaveBeenCalled();
    expect(spies.analyzeContractLlmCaseFiles).not.toHaveBeenCalled();
  });

  it("[REQ-08] keeps victim spender receiver and route roles distinct and leaves ordinary transferFrom as context", async () => {
    const victimAddress = OWNER;
    const spenderAddress = SUBJECT;
    const operatorAddress = VERIFY20;
    const receiverAddress = BRIDGERS;
    const target = await vi.importActual<Record<string, unknown>>(
      "../../src/forensics/contractDecision"
    );
    const { buildContractDrivenEvidenceProfiles } = await import("../../src/forensics/contractDrivenEvidence");
    const roles = await buildContractDrivenEvidenceProfiles({
      subjectAddress: receiverAddress,
      edges: [{
        id: "ordinary-transfer-from",
        fromAddress: victimAddress,
        toAddress: receiverAddress,
        txHash: "ordinary-transfer-from-tx",
        amountRaw: "42000000",
        timestamp: NOW,
        method: "transferFrom(address,address,uint256)",
        edgeType: "transfer_from"
      }],
      getTransaction: async () => ({
        ownerAddress: operatorAddress,
        contractData: {
          contract_address: spenderAddress,
          function_selector: "transferFrom(address,address,uint256)"
        },
        trigger_info: { methodName: "transferFrom" },
        trc20TransferInfo: [{
          from_address: victimAddress,
          to_address: receiverAddress,
          amount_str: "42000000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: {
            tokenId: TRON_USDT_CONTRACT_ADDRESS,
            tokenAbbr: "USDT",
            tokenType: "trc20"
          }
        }]
      })
    });
    expect(target.resolveContractDecisionV2).toBeTypeOf("function");
    const result = (target.resolveContractDecisionV2 as (value: Record<string, unknown>) => any)({
      ...unknownInput(spenderAddress),
      contractProfile: contractProfile(spenderAddress, { hasTransferFromSelector: true }),
      evidence: [
        evidence("metadata:subject", "metadata_context", spenderAddress, null, null),
        evidence("ordinary-transfer-from", "approval_event", spenderAddress)
      ]
    });

    expect(roles.transferProfiles[0]).toMatchObject({
      victimAddress,
      sourceAddress: victimAddress,
      spenderAddress,
      contractAddress: spenderAddress,
      operatorAddress,
      callerAddress: operatorAddress,
      receiverAddress,
      countsAsDrainerContext: true
    });
    expect(new Set([victimAddress, spenderAddress, operatorAddress, receiverAddress]).size).toBe(4);
    expect(result.deterministic).toMatchObject({
      score: 35,
      decision: "REVIEW",
      authority: "context",
      evidenceIds: ["metadata:subject"]
    });
    expect(result.deterministic.authority).not.toMatch(/verify20|exact_debit|drainer/i);
    expectFresh(result);
  });
});
