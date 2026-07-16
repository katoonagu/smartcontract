import { TronWeb } from "tronweb";
import type {
  AddressRefV1 as CoreAddressRefV1,
  ApprovalDrainProvenanceProfile,
  ApprovalSafetyAssessmentV2,
  ContractDecisionV2,
  ForensicCoverageV2,
  KnownServiceSessionV1,
  NarrativeFactV2
} from "../types";
import type { MatrixEvidenceRow } from "../risk/scoringSignalMatrix";

const TRON_BASE58_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TRONSCAN_ADDRESS_URL = "https://tronscan.org/#/address/";

export type AddressRefV1 = CoreAddressRefV1;

export function telegramAddressRef(address: string): AddressRefV1 {
  if (!TRON_BASE58_ADDRESS.test(address) || !TronWeb.isAddress(address)) {
    return { address, display: address, url: null };
  }

  return {
    address,
    display: `${address.slice(0, 4)}…${address.slice(-4)}`,
    url: `${TRONSCAN_ADDRESS_URL}${address}`
  };
}

export function validateTelegramAddressRef(ref: AddressRefV1): AddressRefV1 {
  const canonical = telegramAddressRef(ref.address);
  if (ref.display !== canonical.display || ref.url !== canonical.url) {
    throw new Error("telegram_address_ref_not_canonical");
  }
  return canonical;
}

export type TelegramForensicResultKindV1 =
  | "where_preliminary"
  | "wallet_final"
  | "deep_context"
  | "incoming_deposit"
  | "contract_safety"
  | "approval_safety"
  | "technical_result";

export type ApprovalAudienceContextV1 = "watched_wallet" | "external_address_check";

export type ApprovalPresentationInputV1 = {
  assessment: ApprovalSafetyAssessmentV2;
  audienceContext: ApprovalAudienceContextV1;
  exactDebitProfile: ApprovalDrainProvenanceProfile | null;
};

export type ApprovalPresentationV1 = {
  owner: AddressRefV1;
  spender: AddressRefV1;
  tokenContract: AddressRefV1;
  audienceContext: ApprovalAudienceContextV1;
  allowanceState: "confirmed_active" | "confirmed_zero" | "failed" | "stale";
  confirmedAllowanceRaw: string | null;
  isUnlimited: boolean | null;
  balanceAtRiskRaw: string | null;
  debitState: "confirmed" | "not_found" | "unknown";
  debitAmountRaw: string | null;
  exactVerify20: boolean;
  campaignEvidenceIds: string[];
  serviceSession: KnownServiceSessionV1 | null;
};

export type TelegramAssessmentPresentationV1 =
  | {
      kind: "aml_risk";
      score: number;
      level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
      indicator: "🟢" | "🟡" | "🟠" | "🔴";
      actionTextKey: string | null;
      anchorId: string;
      preferredFactId: string;
    }
  | {
      kind: "contract_risk";
      score: number;
      level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
      indicator: "🟢" | "🟡" | "🟠" | "🔴";
      actionTextKey: string;
      evidenceIds: string[];
    }
  | {
      kind: "wallet_safety";
      score: number | null;
      level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
      action: "NONE" | "REVOKE_IF_UNUSED" | "REVOKE_NOW" | "CONFIRM_ALLOWANCE";
      indicator: "🟢" | "🟡" | "🟠" | "🔴" | "⚪";
      amlScoreImpact: 0;
    };

export type TelegramRoutePresentationV1 = {
  routeId: string;
  direction: "inbound" | "outbound";
  from: AddressRefV1;
  to: AddressRefV1;
  amountRaw: string;
  asset: "USDT" | "USDD" | "TRX" | "BTTOLD" | "other";
  share: number | null;
  transferCount: number | null;
  evidenceIds: string[];
};

export type TelegramForensicResultV1 = {
  version: "telegram-forensic-result-v1";
  kind: TelegramForensicResultKindV1;
  locale: "ru" | "en";
  titleTextKey: string;
  checkedWallet: AddressRefV1;
  resultState: "final" | "preliminary" | "no_final" | "technical_limit";
  assessment: TelegramAssessmentPresentationV1 | null;
  primaryFact: NarrativeFactV2 | null;
  secondaryFacts: NarrativeFactV2[];
  routes: TelegramRoutePresentationV1[];
  coverage: ForensicCoverageV2 | null;
  legacyCoverage: { selectedCount: number | null; warningTextKey: string } | null;
  approval: ApprovalPresentationV1 | null;
  contractDecision: ContractDecisionV2 | null;
  technicalLimitTextKey: string | null;
};

export const TELEGRAM_FACT_TEXT_KEYS_V1 = [
  "approval_drain_roles_distinct",
  "bridge_shared_liquidity_inbound",
  "collector_context_only",
  "collector_disjoint_independent_signal",
  "contract_exact_debit_confirmed",
  "fast_behavior_context",
  "gasfree_account_structural",
  "htx_historical_policy_context",
  "low_balance_latest_five_principal",
  "official_usdt_registry_contract",
  "outgoing_blacklisted_counterparty_later_frozen",
  "principal_transfer_context",
  "true_no_principal_activity",
  "usdd_psm_inbound_shared_liquidity",
  "usdd_psm_outbound_shared_liquidity",
  "where_preliminary_bridge_shared_liquidity"
] as const;

export const TELEGRAM_SCORE_FACT_SIGNALS_V1 = {
  subject_restriction: [
    "stablecoin_usdt_blacklisted"
  ],
  direct_counterparty_policy: [
    "direct_counterparty_current_usdt_blacklist"
  ],
  hard_proof: [
    "subject_restricted",
    "forensic_approval_drain_provenance",
    "internal_label_approval_drain_proximity",
    "internal_label_scam",
    "internal_label_reported_scam",
    "internal_label_stolen_funds",
    "internal_label_phishing",
    "internal_label_risky_contract",
    "internal_label_whitebit",
    "internal_label_darknet_exchange",
    "approval_drain_exact_transfer_from",
    "deep_high_risk_extended_provenance",
    "where_approval_drain",
    "where_scam_or_blacklist",
    "fast_critical",
    "approval_drain",
    "scam_or_blacklist",
    "sanctioned_service",
    "cross_chain_sanctioned_service"
  ],
  source_policy: [
    "exact_usdd_psm_exposure",
    "source_policy_htx_huobi",
    "source_policy_whitebit",
    "source_policy_bridge_router_dex",
    "source_policy_cross_chain_boundary",
    "source_policy_no_name_token_liquidity",
    "source_policy_mixer",
    "source_policy_sanctioned_service",
    "source_policy_unknown_contract",
    "source_policy_unknown_cex",
    "source_policy_allowlisted_cex",
    "source_policy_risky_label",
    "deep_source_policy_inbound_provenance",
    "deep_source_policy_extended_provenance",
    "where_sanctioned_service",
    "where_exchange_policy_decline",
    "htx_huobi",
    "whitebit",
    "bridge_router_dex",
    "cross_chain_boundary",
    "no_name_token_liquidity",
    "mixer",
    "sanctioned_service",
    "unknown_contract",
    "unknown_cex",
    "allowlisted_cex",
    "risky_label",
    "unresolved_source_boundary",
    "unresolved_unknown_source_boundary",
    "aggregate_source_policy",
    "cross_chain_no_name_token_liquidity",
    "cross_chain_tornado_or_mixer",
    "cross_chain_bridge_boundary",
    "cross_chain_dex_router_boundary",
    "cross_chain_unknown_contract",
    "source_policy_unresolved_source_boundary",
    "source_policy_unresolved_unknown_source_boundary",
    "source_policy_aggregate_source_policy",
    "source_policy_cross_chain_no_name_token_liquidity",
    "source_policy_cross_chain_tornado_or_mixer",
    "source_policy_cross_chain_bridge_boundary",
    "source_policy_cross_chain_dex_router_boundary",
    "source_policy_cross_chain_unknown_contract"
  ],
  incoming_deposit_source_policy: [
    "incoming_fresh_risky_label_source",
    "incoming_fresh_htx_huobi_source",
    "incoming_fresh_htx_huobi_context",
    "incoming_fresh_bridge_router_dex_source",
    "incoming_fresh_unknown_contract_source"
  ],
  service_linked_pattern: [
    "deep_high_risk_inbound_provenance",
    "where_drain_episode_transit_pattern"
  ],
  route_linked_approval_pattern: [
    "route_linked_approval_pattern"
  ],
  asset_continuation: [
    "asset_continuation"
  ],
  typology_subgraph_pattern: [
    "split_merge_service_exit",
    "fast_cashout_to_legitimate_service"
  ],
  contract_suspicion: [
    "exact_verify20_contract_pattern"
  ],
  counterparty_context: [
    "historical_approval_drain_context",
    "deep_high_risk_inbound_provenance",
    "deep_source_policy_inbound_provenance",
    "deep_high_risk_extended_provenance",
    "deep_source_policy_extended_provenance",
    "asset_continuation",
    "deep_service_exposure_context",
    "deep_service_boundary_context",
    "deep_counterparty_risk_context",
    "exact_labeled_counterparty",
    "derived_labeled_counterparty",
    "counterparty_fast_risk_snapshot",
    "counterparty_behavior_context",
    "service_boundary_context",
    "no_exact_label_or_cached_taint",
    "provider_partial",
    "where_approval_drain",
    "where_scam_or_blacklist",
    "where_residual_unresolved_below_materiality",
    "where_dense_hop_unresolved_below_materiality",
    "incoming_htx_huobi_corridor_context",
    "incoming_service_corridor_context"
  ],
  behavior_only_prior: [
    "collector_transit_behavior",
    "collector_plus_independent_signal",
    "historical_transit_pattern",
    "address_behavior_deposit_then_drain",
    "address_behavior_large_inflow_preserved_outflow",
    "address_behavior_fast_post_deposit_exit",
    "address_behavior_drain_to_service_infrastructure",
    "address_behavior_high_volume_transit",
    "address_behavior_fan_in_fan_out",
    "address_behavior_large_outgoing_concentration",
    "address_behavior_top_counterparty_concentration",
    "address_behavior_collector_like_wallet",
    "deep_wallet_role_victim",
    "deep_wallet_role_drainer_spender",
    "deep_wallet_role_first_receiver",
    "deep_wallet_role_collector",
    "deep_wallet_role_mule",
    "deep_wallet_role_cashout_service",
    "deep_wallet_role_treasury_like",
    "deep_wallet_role_unknown",
    "forensic_route_linked_approval_pattern",
    "forensic_service_exposure",
    "forensic_darknet_exchange_provenance",
    "forensic_inbound_provenance",
    "forensic_extended_provenance",
    "forensic_counterparty_whitebit",
    "forensic_counterparty_darknet_exchange",
    "forensic_counterparty_darknet_exchange_proximity",
    "forensic_counterparty_fast_snapshot_context",
    "forensic_operational_boundary_flow",
    "forensic_boundary_exposure_context",
    "forensic_address_behavior",
    "forensic_operational_laundering_pattern",
    "new_wallet_high_volume",
    "very_new_wallet_active",
    "internal_label_victim",
    "internal_label_mule",
    "internal_label_collector",
    "internal_label_bridge",
    "internal_label_exchange",
    "internal_label_trusted",
    "internal_label_false_positive",
    "internal_label_needs_review",
    "internal_label_mixer_like",
    "internal_label_darknet_exchange_proximity",
    "incoming_wallet_exposure_profile",
    "subject_exposure_context",
    "operational_unknown_origin",
    "unresolved_origin",
    "guarded_approval_review_insufficient_coverage",
    "source_provenance_materiality",
    "cross_chain_data_exhausted",
    "cross_chain_candidate_only",
    "cross_chain_none"
  ],
  coverage_uncertainty: [
    "insufficient_coverage"
  ],
  clean_or_operational: [
    "where_clean_or_operational",
    "clean_source_proven",
    "clean_cex_source"
  ]
} as const satisfies Record<MatrixEvidenceRow, readonly string[]>;

export type TelegramStaticFactTextKeyV1 = (typeof TELEGRAM_FACT_TEXT_KEYS_V1)[number];
type TelegramScoreFactSignalRegistryV1 = typeof TELEGRAM_SCORE_FACT_SIGNALS_V1;
export type TelegramScoreFactTextKeyV1 = {
  [Row in keyof TelegramScoreFactSignalRegistryV1]:
    `score.${Row & string}.${TelegramScoreFactSignalRegistryV1[Row][number]}`
}[keyof TelegramScoreFactSignalRegistryV1];
export type TelegramFactTextKeyV1 = TelegramStaticFactTextKeyV1 | TelegramScoreFactTextKeyV1;

function matrixEvidenceRow(value: string): MatrixEvidenceRow | null {
  return Object.hasOwn(TELEGRAM_SCORE_FACT_SIGNALS_V1, value)
    ? value as MatrixEvidenceRow
    : null;
}

function scoreFactTextKey(value: string): TelegramScoreFactTextKeyV1 | null {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "score") return null;
  const row = matrixEvidenceRow(parts[1] ?? "");
  const signal = parts[2] ?? "";
  if (row === null) return null;
  const allowedSignals: readonly string[] = TELEGRAM_SCORE_FACT_SIGNALS_V1[row];
  return allowedSignals.includes(signal)
    ? value as TelegramScoreFactTextKeyV1
    : null;
}

export function resolveTelegramFactTextKey(value: string): TelegramFactTextKeyV1 | null {
  return TELEGRAM_FACT_TEXT_KEYS_V1.find((key) => key === value) ?? scoreFactTextKey(value);
}
