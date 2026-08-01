import type { BotLocale } from "../types";
import { adaptTelegramForensicResult } from "./forensicPresentationAdapters";
import { renderTelegramForensicResult } from "./forensicResultRenderer";

export type TelegramTechnicalReasonV1 =
  | "insufficient_validated_data"
  | "insufficient_coverage"
  | "provider_error"
  | "provider_history_unavailable"
  | "hard_safety_limit_exceeded";

export function renderTelegramTechnicalResult(input: {
  checkedWalletAddress: string;
  locale: BotLocale;
  evaluatedAt: Date;
  reason: TelegramTechnicalReasonV1;
}): string {
  return renderTelegramForensicResult(adaptTelegramForensicResult({
    kind: "technical_result",
    locale: input.locale,
    evaluatedAt: input.evaluatedAt.toISOString(),
    checkedWalletAddress: input.checkedWalletAddress,
    resultState: "technical_limit",
    scoreAnchorV2: null,
    narrativeFactsV2: [],
    scoringEvidenceV2: [],
    amlPresentation: null,
    routes: [],
    coverageV2: null,
    legacyCoverage: null,
    approvalInput: null,
    contractDecision: null,
    technicalLimitTextKey: input.reason
  }));
}
