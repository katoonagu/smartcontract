import type { ContractRiskContext } from "../approvals/contractIntelligence";
import type { ContractAnalysisCaseFile, ContractLlmVerdictSummary, IncomingDepositOriginPath } from "../types";
import { CONTRACT_LLM_VERDICT_POLICY_VERSION } from "./contractLlmVerdict";

export type AnalyzeIncomingDepositContractsInput = {
  subjectAddress: string;
  watchedWallet: string;
  depositTxHash: string;
  originPaths: IncomingDepositOriginPath[];
  getContractIntelligenceProfile(address: string): Promise<ContractRiskContext | null>;
  getTransaction(txHash: string): Promise<unknown>;
  analyzeContractLlmCaseFiles?: (caseFiles: ContractAnalysisCaseFile[]) => Promise<ContractLlmVerdictSummary[]>;
};

export type AnalyzeIncomingDepositContractsResult = {
  verdicts: ContractLlmVerdictSummary[];
  caseFileCount: number;
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

export async function analyzeIncomingDepositContracts(
  input: AnalyzeIncomingDepositContractsInput
): Promise<AnalyzeIncomingDepositContractsResult> {
  if (!input.analyzeContractLlmCaseFiles) {
    return { verdicts: [], caseFileCount: 0 };
  }

  const caseFiles: ContractAnalysisCaseFile[] = [];
  for (const contractAddress of contractCandidates(input.originPaths)) {
    const relatedPaths = input.originPaths.filter((path) => path.pathAddresses[0] === contractAddress);
    const txHashes = [...new Set(relatedPaths.flatMap((path) => path.txHashes))];
    const txDetails = [];
    for (const txHash of txHashes.slice(0, 4)) {
      txDetails.push({
        txHash,
        raw: await input.getTransaction(txHash).catch((error) => ({
          error: error instanceof Error ? error.message : String(error)
        }))
      });
    }

    const profile = await input.getContractIntelligenceProfile(contractAddress).catch(() => null);
    const evidenceIds = [...new Set([input.depositTxHash, ...txHashes])];
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
      serviceClassification: null,
      contractProfile: {
        ...(profile ? { intelligenceProfile: profile } : {}),
        incomingDepositContext: {
          depositTxHash: input.depositTxHash,
          watchedWallet: input.watchedWallet,
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

  if (caseFiles.length === 0) return { verdicts: [], caseFileCount: 0 };
  return {
    verdicts: await input.analyzeContractLlmCaseFiles(caseFiles),
    caseFileCount: caseFiles.length
  };
}
