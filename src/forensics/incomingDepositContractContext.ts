import type { ContractRiskContext } from "../approvals/contractIntelligence";
import type {
  ContractAnalysisCaseFile,
  ContractLlmVerdictSummary,
  IncomingDepositOriginPath,
  ServiceClassification
} from "../types";
import type { ContractEnrichmentResult } from "./contractEnrichment";
import { CONTRACT_LLM_VERDICT_POLICY_VERSION } from "./contractLlmVerdict";

export type AnalyzeIncomingDepositContractsInput = {
  subjectAddress: string;
  watchedWallet: string;
  depositTxHash: string;
  originPaths: IncomingDepositOriginPath[];
  getContractIntelligenceProfile(address: string): Promise<ContractRiskContext | null>;
  enrichContractClassification?(address: string): Promise<ContractEnrichmentResult>;
  getTransaction(txHash: string): Promise<unknown>;
  analyzeContractLlmCaseFiles?: (caseFiles: ContractAnalysisCaseFile[]) => Promise<ContractLlmVerdictSummary[]>;
};

export type AnalyzeIncomingDepositContractsResult = {
  verdicts: ContractLlmVerdictSummary[];
  caseFileCount: number;
  resolvedOriginPaths?: IncomingDepositOriginPath[];
};

function contractCandidates(paths: IncomingDepositOriginPath[]): string[] {
  const result = new Set<string>();
  for (const path of paths) {
    if (path.stoppedReason !== "unknown_contract_reached") continue;
    const contract = path.pathAddresses[0];
    if (contract) result.add(contract);
  }
  return [...result];
}

function isResolvedBoundary(enrichment: ContractEnrichmentResult): boolean {
  return enrichment.classification.category !== "none" && enrichment.classification.category !== "unknown_contract";
}

function normalizeIdentity(identity: string | null): string {
  return (identity ?? "").toLowerCase();
}

function rewritePathForClassification(
  path: IncomingDepositOriginPath,
  classification: ServiceClassification
): IncomingDepositOriginPath | null {
  const identity = normalizeIdentity(classification.identity);
  const knownCleanCex = [
    "binance",
    "bybit",
    "okx",
    "coinbase",
    "kraken",
    "kucoin",
    "bitget",
    "mexc",
    "bitstamp",
    "crypto.com",
    "cryptocom"
  ];
  if (classification.category === "cex" && (identity.includes("htx") || identity.includes("huobi"))) {
    return {
      ...path,
      stoppedReason: "htx_huobi_reached",
      sourcePolicy: "hard_decline",
      score: Math.max(78, path.score),
      verdict: "DECLINE",
      reasons: [`Deposit path reaches HTX/Huobi boundary resolved by contract enrichment (${classification.identity ?? "unknown identity"}).`]
    };
  }
  if (classification.category === "cex" && identity.includes("whitebit")) {
    return {
      ...path,
      stoppedReason: "whitebit_reached",
      sourcePolicy: "medium_policy",
      score: Math.max(52, path.score),
      verdict: "DECLINE",
      reasons: [`Deposit path reaches WhiteBIT boundary resolved by contract enrichment (${classification.identity ?? "unknown identity"}).`]
    };
  }
  if (classification.category === "cex" && knownCleanCex.some((keyword) => identity.includes(keyword))) {
    return {
      ...path,
      stoppedReason: "clean_cex_reached",
      sourcePolicy: "clean",
      score: 5,
      verdict: "ACCEPTABLE",
      reasons: [`Deposit path reaches clean CEX boundary resolved by contract enrichment (${classification.identity ?? "unknown identity"}).`]
    };
  }
  if (
    classification.category === "bridge" ||
    classification.category === "bridge_pool" ||
    classification.category === "router" ||
    classification.category === "dex" ||
    classification.category === "swap_adapter"
  ) {
    return {
      ...path,
      stoppedReason: "bridge_router_dex_reached",
      sourcePolicy: "hard_decline",
      score: Math.max(70, path.score),
      verdict: "DECLINE",
      reasons: [
        `Deposit path reaches bridge/router/DEX boundary resolved by contract enrichment (${classification.identity ?? classification.category}).`
      ]
    };
  }
  return null;
}

function deterministicServiceVerdict(input: {
  contractAddress: string;
  classification: ServiceClassification;
  evidenceIds: string[];
}): ContractLlmVerdictSummary {
  return {
    source: "deterministic",
    cacheMatch: null,
    reusedFromContractAddress: null,
    providerLabel: "deterministic-service-classifier",
    model: "service-classifier",
    contractAddress: input.contractAddress,
    caseFileHash: `deterministic:${input.contractAddress}:${input.classification.category}:${input.classification.identity ?? "unknown"}`,
    cacheId: null,
    verdict: "legitimate_service",
    confidence: input.classification.confidence === "high" ? 0.9 : 0.75,
    contractRiskScore: input.classification.confidence === "high" ? 25 : 35,
    decisionRecommendation: "ACCEPTABLE",
    reasons: [
      `Contract enrichment resolved the boundary as a legitimate ${input.classification.category}${input.classification.identity ? ` (${input.classification.identity})` : ""}.`
    ],
    citedEvidenceIds: input.evidenceIds,
    falsePositiveNotes: []
  };
}

function unavailableContractVerdict(input: {
  contractAddress: string;
  evidenceIds: string[];
  reason?: string | null;
}): ContractLlmVerdictSummary {
  return {
    source: "unavailable",
    cacheMatch: null,
    reusedFromContractAddress: null,
    providerLabel: "unavailable",
    model: "contract-analysis-unavailable",
    contractAddress: input.contractAddress,
    caseFileHash: `unavailable:${input.contractAddress}:${input.evidenceIds.join(":")}`,
    cacheId: null,
    verdict: "unknown_insufficient_data",
    confidence: 0,
    contractRiskScore: 58,
    decisionRecommendation: "DECLINE",
    reasons: [input.reason ?? "Contract analysis was unavailable for an unresolved unknown-contract funding path."],
    citedEvidenceIds: input.evidenceIds,
    falsePositiveNotes: [],
    error: input.reason ?? "contract analysis unavailable"
  };
}

function isServiceLikeClassification(classification: ServiceClassification): boolean {
  return classification.category === "service" || classification.category === "protocol" || classification.category === "hot_wallet";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function analyzeIncomingDepositContracts(
  input: AnalyzeIncomingDepositContractsInput
): Promise<AnalyzeIncomingDepositContractsResult> {
  const caseFiles: ContractAnalysisCaseFile[] = [];
  const verdicts: ContractLlmVerdictSummary[] = [];
  let resolvedOriginPaths: IncomingDepositOriginPath[] | undefined;
  for (const contractAddress of contractCandidates(input.originPaths)) {
    const currentPaths = resolvedOriginPaths ?? input.originPaths;
    const relatedPaths = currentPaths.filter(
      (path) => path.stoppedReason === "unknown_contract_reached" && path.pathAddresses[0] === contractAddress
    );
    const txHashes = [...new Set(relatedPaths.flatMap((path) => path.txHashes))];
    let enrichment: ContractEnrichmentResult | null = null;
    let enrichmentError: string | null = null;
    if (input.enrichContractClassification) {
      try {
        enrichment = await input.enrichContractClassification(contractAddress);
      } catch (error) {
        enrichmentError = errorMessage(error);
      }
    }
    if (enrichment && isResolvedBoundary(enrichment)) {
      const rewrittenPaths = relatedPaths
        .map((path) => rewritePathForClassification(path, enrichment.classification))
        .filter((path): path is IncomingDepositOriginPath => path !== null);
      if (rewrittenPaths.length > 0) {
        const byTxKey = new Map(rewrittenPaths.map((path) => [path.txHashes.join(":"), path]));
        resolvedOriginPaths = currentPaths.map((path) =>
          path.stoppedReason === "unknown_contract_reached" && path.pathAddresses[0] === contractAddress
            ? byTxKey.get(path.txHashes.join(":")) ?? path
            : path
        );
      } else if (isServiceLikeClassification(enrichment.classification)) {
        verdicts.push(deterministicServiceVerdict({
          contractAddress,
          classification: enrichment.classification,
          evidenceIds: [...new Set([input.depositTxHash, ...txHashes])]
        }));
      }
      continue;
    }

    const evidenceIds = [...new Set([input.depositTxHash, ...txHashes])];
    if (!input.analyzeContractLlmCaseFiles) {
      verdicts.push(unavailableContractVerdict({
        contractAddress,
        evidenceIds,
        reason: enrichmentError
      }));
      continue;
    }

    const txDetails = [];
    for (const txHash of txHashes.slice(0, 4)) {
      txDetails.push({
        txHash,
        raw: await input.getTransaction(txHash).catch((error) => ({
          error: error instanceof Error ? error.message : String(error)
        }))
      });
    }

    const profile = enrichment?.contractProfile ?? await input.getContractIntelligenceProfile(contractAddress).catch(() => null);
    caseFiles.push({
      policyVersion: CONTRACT_LLM_VERDICT_POLICY_VERSION,
      subjectAddress: input.subjectAddress,
      checkedWalletAddress: input.watchedWallet,
      contractAddress,
      currentUsdtBalanceRaw: null,
      balanceFormingTransfers: [],
      originPaths: [],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      serviceClassification: enrichment?.classification ?? null,
      contractProfile: {
        ...(profile ? { intelligenceProfile: profile } : {}),
        incomingDepositContext: {
          depositTxHash: input.depositTxHash,
          watchedWallet: input.watchedWallet,
          ...(enrichment || enrichmentError
            ? {
                enrichment: enrichment
                  ? {
                      profileSource: enrichment.profileSource,
                      liveFetchError: enrichment.liveFetchError,
                      classification: enrichment.classification,
                      metadata: enrichment.metadata
                    }
                  : { error: enrichmentError }
              }
            : {}),
          relatedPaths: relatedPaths.map((path) => ({
            pathAddresses: path.pathAddresses,
            txHashes: path.txHashes,
            amountCoverageRatio: path.amountCoverageRatio,
            amountContinuity: path.amountContinuity,
            proximityHops: path.proximityHops,
            reasons: path.reasons
          })),
          transactionDetails: txDetails
        }
      },
      evidenceIds,
      policyQuestion:
        "Classify whether this unknown contract funding an incoming deposit looks like a legitimate service, drainer-like contract, suspicious unknown contract, or insufficient data. Return JSON only."
    });
  }

  if (caseFiles.length === 0) {
    return {
      verdicts,
      caseFileCount: 0,
      ...(resolvedOriginPaths ? { resolvedOriginPaths } : {})
    };
  }
  return {
    verdicts: [
      ...verdicts,
      ...(input.analyzeContractLlmCaseFiles ? await input.analyzeContractLlmCaseFiles(caseFiles) : [])
    ],
    caseFileCount: caseFiles.length,
    ...(resolvedOriginPaths ? { resolvedOriginPaths } : {})
  };
}
