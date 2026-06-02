import type {
  CrossChainAddress,
  CrossChainContinuationEdge,
  CrossChainContinuationEvidenceClass,
  CrossChainContinuationReport,
  CrossChainContinuationSeed
} from "../types";
import type { CrossChainProviderBudget } from "./crossChainBudget";

export type ChainContinuationProvider = {
  chain: string;
  listEdgesForAddress(input: {
    address: CrossChainAddress;
    seed: CrossChainContinuationSeed;
    budget: CrossChainProviderBudget;
  }): Promise<CrossChainContinuationEdge[]>;
};

export type {
  CrossChainContinuationEdge,
  CrossChainContinuationEvidenceClass,
  CrossChainContinuationReport,
  CrossChainContinuationSeed
} from "../types";
