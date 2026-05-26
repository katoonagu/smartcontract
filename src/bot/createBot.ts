import { Bot, type Context, type InlineKeyboard } from "grammy";
import type { AppConfig } from "../config";
import { checkAddress, checkTransactionHash } from "../check/manualCheck";
import type { ManualCheckResult, ManualRiskSignals } from "../check/manualCheck";
import { createAddressExposureRiskSignalProvider } from "../check/addressExposureSignals";
import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import { addressBehaviorEffectiveScore } from "../forensics/addressBehavior";
import { calculateRisk, type RiskSignal } from "../risk/riskEngine";
import type { Db } from "../storage/db";
import { formatSafetyRecheckSummary, parseSafetyRecheckTarget, runSafetyRecheck } from "../approvals/safetyRecheck";
import {
  addCustomerAlertRecipient,
  addWatchedWallet,
  clearTelegramUserPendingAction,
  getTelegramUserSession,
  getWalletApprovalSummary,
  getWalletDashboardSnapshot,
  getWalletPollState,
  getAddressMetadata,
  getContractIntelligenceProfile,
  getForensicCheckJob,
  listCustomerAlertRecipients,
  listAddressLabels,
  listWatchedWallets,
  removeCustomerAlertRecipient,
  removeWatchedWallet,
  saveAddressLabel,
  createOrReuseForensicCheckJob,
  saveRiskEvaluationEvidence,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  setTelegramUserPendingAction,
  updateWatchedWalletAlertMode,
  upsertTelegramUser,
  upsertWalletDashboardSnapshot
} from "../storage/repositories";
import type { CustomerAlertMode, ForensicCheckJob } from "../storage/repositories";
import type {
  ApprovalDrainProvenanceProfile,
  BoundaryExposureProfile,
  CounterpartyRiskProfile,
  ExtendedProvenanceProfile,
  InboundProvenanceProfile,
  RiskLabel,
  RiskLevel,
  RiskReport,
  StablecoinRestrictionProfile,
  WalletAlertMode,
  WalletRoleProfile,
  WatchedWallet
} from "../types";
import { classifyInput } from "../tron/address";
import type { TronApprovalClient, TronClient, TronDashboardClient } from "../tron/tronClient";
import { getWalletDashboard } from "../wallet/dashboard";
import {
  bold,
  bulletList,
  code,
  escapeHtml,
  formatRiskIcon,
  telegramHtmlMessage,
  type TelegramHtmlMessage
} from "../alerts/telegramHtml";
import {
  addWalletPrompt,
  addAlertAdminPrompt,
  alertAdminAddedMessage,
  alertAdminNotFoundMessage,
  alertAdminRemovedMessage,
  alertAdminsMessage,
  analyticsMessage,
  checkAddressPrompt,
  checkTxPrompt,
  dashboardMessage,
  helpMessage,
  homeMessage,
  myIdMessage,
  profileMessage,
  removeAlertAdminPrompt,
  removeConfirmMessage,
  riskIntelOverviewMessage,
  safetyMessage,
  securityMessage,
  settingsMessage,
  walletAlertModeMessage,
  walletAlertModeUpdatedMessage,
  walletsMessage
} from "./messages";
import {
  alertAdminsKeyboard,
  backToWalletKeyboard,
  cancelKeyboard,
  mainMenuKeyboard,
  parseCallbackData,
  profileKeyboard,
  settingsKeyboard,
  walletAlertModeKeyboard,
  walletDashboardKeyboard,
  walletRemoveKeyboard,
  walletsKeyboard
} from "./keyboards";
import { shouldHandlePendingText } from "./pendingActions";

const ALLOWED_LABELS: readonly RiskLabel[] = [
  "scam",
  "stolen_funds",
  "phishing",
  "mule",
  "collector",
  "bridge",
  "exchange",
  "trusted",
  "false_positive",
  "needs_review",
  "mixer_like",
  "risky_contract",
  "darknet_exchange",
  "approval_drain_proximity"
];

const allowedLabelSet = new Set<RiskLabel>(ALLOWED_LABELS);
const allowedWalletAlertModes = new Set<WalletAlertMode>(["realtime", "risk_only", "digest", "paused"]);
const telegramIdPattern = /^\d{1,20}$/;

type BotMessage = string | TelegramHtmlMessage;
type BotSendOptions = {
  reply_markup?: InlineKeyboard;
  parse_mode?: "HTML";
};
type CreateBotOptions = {
  getAddressRiskSignalsForAddress?: (address: string) => Promise<ManualRiskSignals>;
  queueDeepForensicJob?: (input: {
    subjectAddress: string;
    chatId: string | null;
    requestedBy: string | null;
    fastRiskSnapshot?: FastRiskSnapshot;
  }) => Promise<ForensicCheckJob>;
  getForensicCheckJob?: (id: string) => Promise<ForensicCheckJob | null>;
};

function telegramId(ctx: { from?: { id: number } }): string {
  if (!ctx.from?.id) throw new Error("Telegram user id is missing");
  return String(ctx.from.id);
}

function isServiceAdmin(config: AppConfig, id: string): boolean {
  return config.serviceAdminTelegramIds.has(id);
}

function messageText(message: BotMessage): string {
  return typeof message === "string" ? message : message.text;
}

function messageOptions(message: BotMessage, keyboard?: InlineKeyboard): BotSendOptions | undefined {
  const options: BotSendOptions = {};
  if (keyboard) options.reply_markup = keyboard;
  if (typeof message !== "string") options.parse_mode = message.parseMode;
  return Object.keys(options).length > 0 ? options : undefined;
}

async function sendMessage(
  ctx: { reply(text: string, options?: BotSendOptions): Promise<unknown> },
  message: BotMessage,
  keyboard?: InlineKeyboard
): Promise<void> {
  await ctx.reply(messageText(message), messageOptions(message, keyboard));
}

function combineMessages(messages: TelegramHtmlMessage[]): TelegramHtmlMessage {
  return {
    text: messages.map((message) => message.text).join("\n\n"),
    parseMode: "HTML"
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatRawUsdt(amountRaw: string): string {
  if (!/^\d+$/.test(amountRaw)) return amountRaw;
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} USDT` : `${whole} USDT`;
}

function formatDurationMs(value: number | null): string {
  if (value === null) return "none";
  const minute = 60_000;
  const hour = 60 * minute;
  if (value < minute) return `${Math.round(value / 1000)}s`;
  if (value < hour) return `${Math.round(value / minute)}m`;
  return `${Math.round(value / hour)}h`;
}

type ForensicSurface = {
  serviceExposureProfiles: ManualCheckResult["serviceExposureProfiles"];
  addressBehaviorProfiles: ManualCheckResult["addressBehaviorProfiles"];
  inboundProvenanceProfiles?: InboundProvenanceProfile[];
  counterpartyRiskProfiles?: CounterpartyRiskProfile[];
  approvalDrainProvenanceProfiles?: ApprovalDrainProvenanceProfile[];
  stablecoinRestrictionProfiles?: StablecoinRestrictionProfile[];
  boundaryExposureProfiles?: BoundaryExposureProfile[];
  walletRoleProfiles?: WalletRoleProfile[];
  extendedProvenanceProfiles?: ExtendedProvenanceProfile[];
  missingChecks: string[];
};

type FastRiskSnapshot = {
  score: number;
  level: RiskLevel;
};

const riskLevelRank: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL";
}

function riskLine(report: RiskReport, label = "Risk", includeBeta = true): string {
  const suffix = includeBeta ? ` (${escapeHtml(report.level)}, beta)` : ` (${escapeHtml(report.level)})`;
  return `${bold(label)}: ${formatRiskIcon(report.level)} ${code(`${report.score}/100`)}${suffix}`;
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function shortIdentifier(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function firstServiceExposureProfile(result: ForensicSurface): ForensicSurface["serviceExposureProfiles"][number] | null {
  const profile = result.serviceExposureProfiles[0] ?? null;
  return profile && profile.exposureScore > 0 ? profile : null;
}

function serviceExposureSignalLines(result: ForensicSurface): string[] {
  const profile = firstServiceExposureProfile(result);
  if (!profile) return [];
  const topMerged = profile.topMergedServiceFlows[0] ?? null;
  const topCounterparty = profile.topServiceCounterparties[0] ?? null;
  const ratio = topMerged ? profile.mergedServiceVolumeRatio : profile.combinedServiceVolumeRatio;
  const category = topMerged?.category ?? topCounterparty?.category ?? profile.dominantCategory ?? "service";
  const identity = topMerged?.identity ?? topCounterparty?.identity ?? null;
  const address = topMerged?.serviceAddress ?? topCounterparty?.address ?? null;
  const flowTarget = identity ?? (address ? shortIdentifier(address) : null);
  const flowSuffix = flowTarget ? ` via ${flowTarget}` : "";
  const lines = [
    `${formatPercent(ratio)} of outgoing USDT reaches ${category} infrastructure${flowSuffix}.`
  ];

  const preservation = topMerged?.amountPreservationRatio ?? profile.bestAmountPreservationRatio;
  if (preservation !== null && preservation !== undefined) {
    lines.push(`Amount preservation on the strongest service route is ${formatPercent(preservation)}.`);
  }
  if (category === "unknown_contract") {
    lines.push("Unknown contract exposure requires manual review.");
  }
  return lines;
}

function addressBehaviorSignalLines(result: ForensicSurface): string[] {
  const profile = result.addressBehaviorProfiles[0] ?? null;
  if (!profile) return [];
  const score = addressBehaviorEffectiveScore(profile);
  const hasLowContext = profile.features.some((feature) => feature.code === "low_context_dampener");
  if (score <= 0 && !hasLowContext) return [];

  const lines: string[] = [];
  if (profile.inflowToOutflowRatio !== null && profile.timeToFirstOutgoingMs !== null) {
    lines.push(`${formatPercent(profile.inflowToOutflowRatio)} of received USDT was redistributed within ~${formatDurationMs(profile.timeToFirstOutgoingMs)}.`);
  }
  if (profile.topOutgoingCounterpartyAddress) {
    lines.push(
      `Top outgoing counterparty ${shortIdentifier(profile.topOutgoingCounterpartyAddress)} received ${formatRawUsdt(profile.topOutgoingCounterpartyRaw ?? "0")} across ${profile.topOutgoingCounterpartyTxCount} transfers (${formatPercent(profile.topOutgoingCounterpartyRatio)}).`
    );
  }
  const primaryReason = profile.features.find((feature) => feature.scoreImpact > 0)?.label ?? null;
  if (primaryReason) lines.push(primaryReason);
  return lines;
}

function firstBoundaryExposureProfile(result: ForensicSurface): BoundaryExposureProfile | null {
  const profile = result.boundaryExposureProfiles?.[0] ?? null;
  return profile && profile.contextScore > 0 && profile.flows.length > 0 ? profile : null;
}

function firstWalletRoleProfile(result: ForensicSurface): WalletRoleProfile | null {
  const profile = result.walletRoleProfiles?.[0] ?? null;
  return profile && profile.primaryRole !== "unknown" ? profile : null;
}

function boundaryExposureSignalLines(result: ForensicSurface): string[] {
  const profile = firstBoundaryExposureProfile(result);
  if (!profile) return [];
  const flow = profile.flows[0];
  const entity = profile.topBoundaryEntities[0] ?? null;
  const direction = flow.direction ?? entity?.direction ?? (profile.outgoingBoundaryVolumeRatio >= profile.incomingBoundaryVolumeRatio ? "outbound" : "inbound");
  const ratio = direction === "outbound" ? profile.outgoingBoundaryVolumeRatio : profile.incomingBoundaryVolumeRatio;
  const category = flow.boundaryCategory ?? entity?.category ?? "service_boundary";
  const identity = flow.boundaryIdentity ?? entity?.identity ?? null;
  const address = flow.boundaryAddress ?? entity?.address ?? null;
  const target = identity ?? (address ? shortIdentifier(address) : null);
  const targetSuffix = target ? ` via ${target}` : "";
  const lines = [
    `${formatPercent(ratio)} of ${direction === "outbound" ? "outgoing" : "incoming"} USDT touches ${category} boundary${targetSuffix} within ${flow.depth} hop(s).`
  ];
  lines.push(`Boundary route preservation is ${formatPercent(flow.amountPreservationRatio)}.`);
  return lines;
}

function walletRoleSignalLines(result: ForensicSurface): string[] {
  const profile = firstWalletRoleProfile(result);
  if (!profile) return [];
  const primary = profile.roles.find((role) => role.role === profile.primaryRole) ?? profile.roles[0] ?? null;
  if (!primary || primary.role === "unknown") return [];
  const lines = [
    `Likely wallet role: ${primary.role} (${primary.confidence} confidence, ${profile.evidenceStrength} evidence).`
  ];
  const primaryReason = primary.reasons.find((reason) => reason.scoreImpact > 0)?.label ?? profile.features.find((feature) => feature.scoreImpact > 0)?.label ?? null;
  if (primaryReason) lines.push(primaryReason);
  return lines;
}

function boundaryExposureEvidenceLines(result: ForensicSurface): string[] {
  const profile = firstBoundaryExposureProfile(result);
  if (!profile) return [];
  const flow = profile.flows[0];
  const roleProfile = firstWalletRoleProfile(result);
  const role = roleProfile?.roles.find((item) => item.role === roleProfile.primaryRole) ?? roleProfile?.roles[0] ?? null;
  const level = levelFromScore(profile.contextScore);
  const target = flow.boundaryIdentity ? `${flow.boundaryCategory} via ${flow.boundaryIdentity}` : `${flow.boundaryCategory} ${shortIdentifier(flow.boundaryAddress)}`;
  return [
    `${bold("Boundary exposure")}: ${formatRiskIcon(level)} ${code(`${profile.contextScore}/100`)} (${escapeHtml(level)})`,
    `${bold("Direction")}: ${code(flow.direction)}; ${bold("Depth")}: ${code(String(flow.depth))}`,
    `${bold("Boundary")}: ${code(target)}`,
    `${bold("Amount")}: ${code(formatRawUsdt(flow.amountRaw))}; ${bold("preservation")}: ${code(formatPercent(flow.amountPreservationRatio))}`,
    flow.viaAddress ? `${bold("Path")}: ${code([profile.subjectAddress, flow.viaAddress, flow.boundaryAddress].map(shortIdentifier).join(" -> "))}` : `${bold("Path")}: ${code([profile.subjectAddress, flow.boundaryAddress].map(shortIdentifier).join(" -> "))}`,
    role && role.role !== "unknown" ? `${bold("Role")}: ${code(`${role.role} (${role.confidence}, ${roleProfile?.evidenceStrength ?? "weak"})`)}` : null,
    `${bold("Tx evidence")}: ${code([flow.subjectTxHash, flow.boundaryTxHash].map(shortIdentifier).join(" -> "))}`
  ].filter((line): line is string => Boolean(line));
}

function topInboundPath(result: ForensicSurface): InboundProvenanceProfile["paths"][number] | null {
  const profile = result.inboundProvenanceProfiles?.[0] ?? null;
  return profile?.paths[0] ?? null;
}

function topCounterpartyRiskProfile(result: ForensicSurface): CounterpartyRiskProfile | null {
  return result.counterpartyRiskProfiles?.find((profile) => profile.score > 0) ?? null;
}

function activeStablecoinRestrictionProfile(result: ForensicSurface): StablecoinRestrictionProfile | null {
  return result.stablecoinRestrictionProfiles?.find((profile) => profile.isBlacklisted) ?? null;
}

function firstApprovalDrainProfile(result: ForensicSurface): ApprovalDrainProvenanceProfile | null {
  return result.approvalDrainProvenanceProfiles?.find((profile) => profile.score > 0) ?? null;
}

function approvalDrainRiskLine(profile: ApprovalDrainProvenanceProfile): string {
  const level = levelFromScore(profile.score);
  return `${bold("Approval-drain provenance")}: ${formatRiskIcon(level)} ${code(`${profile.score}/100`)} (${escapeHtml(level)})`;
}

function inboundProvenanceSignalLines(result: ForensicSurface): string[] {
  const profile = result.inboundProvenanceProfiles?.[0] ?? null;
  const path = topInboundPath(result);
  if (!profile || !path || profile.score <= 0) return [];
  const source = path.label === "darknet_exchange" ? "known darknet exchange seed" : `${path.label} source`;
  return [
    `${formatRawUsdt(profile.matchedInboundVolumeRaw)} inbound matched an exact ${path.depth}-hop on-chain path from a ${source}.`
  ];
}

function counterpartyRiskSignalLines(result: ForensicSurface): string[] {
  const profile = topCounterpartyRiskProfile(result);
  if (!profile) return [];
  return [
    `${formatRawUsdt(profile.amountRaw)} ${profile.direction} volume is directly connected to ${profile.label ?? "labeled"} counterparty ${shortIdentifier(profile.counterpartyAddress)}.`
  ];
}

function stablecoinRestrictionSignalLines(result: ForensicSurface): string[] {
  const profile = activeStablecoinRestrictionProfile(result);
  if (!profile) return [];
  const balance = profile.balanceRaw ? ` Current blocked balance: ${formatRawUsdt(profile.balanceRaw)}.` : "";
  return [`Official TRON USDT contract blacklist state is active for this address.${balance}`];
}

function approvalDrainSignalLines(result: ForensicSurface): string[] {
  const profile = firstApprovalDrainProfile(result);
  if (!profile) return [];
  const hopText = profile.hopDepth === 0 ? "as the first receiver" : `within ${profile.hopDepth} hop(s)`;
  return [
    `Funds are connected to an exact approval-drain flow ${hopText}.`,
    `Approval-drain route preservation is ${formatPercent(profile.amountPreservationRatio)}.`
  ];
}

function topExtendedProvenanceProfile(result: ForensicSurface): ExtendedProvenanceProfile | null {
  return result.extendedProvenanceProfiles
    ?.filter((profile) => profile.paths.length > 0)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function extendedProvenanceSignalLines(result: ForensicSurface): string[] {
  const profile = topExtendedProvenanceProfile(result);
  if (!profile) return [];
  const exact = profile.paths.find((path) => path.evidenceStrength === "exact_labeled_path" && path.candidateScore > 0);
  if (exact) {
    return [
      `Extended ${profile.direction} search found a ${exact.depth}-hop exact labeled path to ${exact.label}; manual review required.`
    ];
  }
  const boundary = profile.paths.find((path) => path.evidenceStrength === "service_boundary_context");
  if (boundary) {
    return [
      `Extended ${profile.direction} search reached ${boundary.boundaryCategory} boundary; public-chain continuity should not be assumed.`
    ];
  }
  return [];
}

function stablecoinRestrictionEvidenceLines(result: ForensicSurface): string[] {
  const profile = activeStablecoinRestrictionProfile(result);
  if (!profile) return [];
  const lines = [
    "USDT blacklist: active",
    `Blocked balance: ${profile.balanceRaw ? formatRawUsdt(profile.balanceRaw) : "not checked"}`,
    `Contract: ${profile.tokenContract}`,
    `Method: ${profile.methods.blacklist}`
  ];
  if (profile.blacklistEventTxHash) {
    const eventParts = [
      profile.blacklistEventTxHash,
      profile.blacklistEventTimestamp,
      profile.blacklistEventBlock ? `block ${profile.blacklistEventBlock}` : null
    ].filter((value): value is string => Boolean(value));
    lines.push(`Blacklist event: ${eventParts.join(" / ")}`);
  } else {
    lines.push("Blacklist event: timeline unavailable");
  }
  return lines;
}

function limitLines(result: ForensicSurface, options: { deepQueued?: boolean; deepStatus?: "completed" | "partial" } = {}): string[] {
  const lines: string[] = [];
  const hasBoundaryStop = result.missingChecks.some((check) => check.toLowerCase().includes("service boundary"));
  if (hasBoundaryStop) {
    lines.push("Service/router boundary reached. Public-chain continuity after this point should not be assumed.");
  }
  const providerChecks = result.missingChecks.filter((check) => !check.toLowerCase().includes("service boundary"));
  if (providerChecks.length > 0) {
    lines.push("Some provider checks were incomplete; review coverage before treating this as final.");
  }
  if (options.deepQueued) {
    lines.push("Deep result may add or change context.");
  }
  if (options.deepStatus === "partial") {
    lines.unshift("Deep analysis completed with limited coverage.");
  }
  return [...new Set(lines)];
}

function keySignalLines(result: ForensicSurface & { report?: RiskReport }): string[] {
  const lines = [
    ...stablecoinRestrictionSignalLines(result),
    ...approvalDrainSignalLines(result),
    ...extendedProvenanceSignalLines(result),
    ...inboundProvenanceSignalLines(result),
    ...counterpartyRiskSignalLines(result),
    ...serviceExposureSignalLines(result),
    ...boundaryExposureSignalLines(result),
    ...walletRoleSignalLines(result),
    ...addressBehaviorSignalLines(result),
    ...(result.report?.reasons.map((reason) => reason.message) ?? [])
  ];
  return [...new Set(lines)].slice(0, 4);
}

function meaningLines(result: ForensicSurface & { report?: RiskReport }, options: { deepQueued?: boolean } = {}): string[] {
  const hasInbound = inboundProvenanceSignalLines(result).length > 0;
  const hasStablecoinRestriction = stablecoinRestrictionSignalLines(result).length > 0;
  const hasApprovalDrain = approvalDrainSignalLines(result).length > 0;
  const hasExtended = extendedProvenanceSignalLines(result).length > 0;
  const hasCounterpartyRisk = counterpartyRiskSignalLines(result).length > 0;
  const hasService = serviceExposureSignalLines(result).length > 0;
  const hasBoundary = boundaryExposureSignalLines(result).length > 0;
  const hasWalletRole = walletRoleSignalLines(result).length > 0;
  const hasBehavior = addressBehaviorSignalLines(result).length > 0;
  const hasDarknetExchangeProximityMarker = result.report?.reasons.some((reason) => reason.code === "internal_label_darknet_exchange_proximity") ?? false;

  if (hasStablecoinRestriction) {
    return ["The official TRON USDT contract reports this address as blacklisted. This is exact token-contract state, not a behavioral guess."];
  }
  if (hasApprovalDrain) {
    return ["Deep analysis connected this address to an exact USDT approval-drain flow. This is route-linked provenance evidence, not legal attribution."];
  }
  if (hasExtended) {
    return ["Extended local-index search found a longer on-chain route candidate. Exact labels and boundaries stay separated from weak inference."];
  }
  if (hasInbound) {
    return ["Deep analysis found exact upstream exposure to a labeled high-risk source. Manual review is recommended."];
  }
  if (hasCounterpartyRisk) {
    return ["Deep analysis found direct exposure to a labeled high-risk counterparty. Manual review is recommended."];
  }
  if (hasDarknetExchangeProximityMarker) {
    return ["This address has a saved high-risk marker from exact on-chain exposure to a manually verified darknet exchange seed within 2 hops."];
  }
  if (hasBoundary && hasWalletRole) {
    return ["Funds touch service-boundary infrastructure where public-chain continuity becomes limited. This is context for manual review, not proof of wrongdoing."];
  }
  if (hasBoundary) {
    return ["Funds touch service-boundary infrastructure where public-chain continuity becomes limited. Manual review is recommended before drawing conclusions."];
  }
  if (hasService && hasBehavior) {
    return ["This address quickly moved most received USDT into service/router infrastructure. Manual review is recommended."];
  }
  if (hasService) {
    return ["Outgoing USDT reaches service, router, CEX, bridge, or contract infrastructure. Manual review is recommended."];
  }
  if (hasBehavior) {
    return ["The address shows rapid transit-like USDT movement. This can also match some legitimate operational wallets."];
  }
  if ((result.report?.score ?? 0) > 0) {
    return ["Connected risk modules found review-worthy signals. Check the key signals below."];
  }
  return [options.deepQueued ? "No strong fast-check signals were found yet; deep analysis may add context." : "No strong risk signals were found in the currently connected checks."];
}

function riskSignalsFromDeepReport(report: DeepAddressForensicReport): {
  graphSignals: RiskSignal[];
  behaviorSignals: RiskSignal[];
  amlSignals: RiskSignal[];
} {
  const serviceProfile = firstServiceExposureProfile(report);
  const behaviorProfile = report.addressBehaviorProfiles[0] ?? null;
  const inboundProfile = report.inboundProvenanceProfiles[0] ?? null;
  const inboundPath = topInboundPath(report);
  const stablecoinRestrictionProfile = activeStablecoinRestrictionProfile(report);
  const approvalDrainProfile = firstApprovalDrainProfile(report);
  const extendedProfile = topExtendedProvenanceProfile(report);
  const boundaryProfile = firstBoundaryExposureProfile(report);

  const graphSignals: RiskSignal[] = [];
  if (approvalDrainProfile) {
    graphSignals.push({
      code: "forensic_approval_drain_provenance",
      message: "Funds are connected to an exact approval-drain flow within 2 hops.",
      scoreImpact: approvalDrainProfile.score,
      source: "approval_drain_provenance",
      confidence: "high",
      severity: approvalDrainProfile.score >= 90 ? "critical" : "high"
    });
  }
  if (serviceProfile) {
    graphSignals.push({
      code: "forensic_service_exposure",
      message: "Service exposure candidate; manual review required.",
      scoreImpact: Math.min(50, serviceProfile.exposureScore),
      source: "forensic_route_search",
      confidence: serviceProfile.exposureScore >= 40 ? "high" : "medium",
      severity: serviceProfile.exposureScore >= 40 ? "high" : "medium"
    });
  }
  if (inboundProfile && inboundProfile.score > 0) {
    graphSignals.push({
      code: inboundPath?.label === "darknet_exchange" ? "forensic_darknet_exchange_provenance" : "forensic_inbound_provenance",
      message: inboundPath?.label === "darknet_exchange"
        ? "Confirmed on-chain exposure to known darknet exchange seed within 2 hops."
        : "Inbound provenance candidate; manual review required.",
      scoreImpact: Math.min(50, inboundProfile.score),
      source: "incoming_provenance",
      confidence: inboundProfile.score >= 40 ? "high" : "medium",
      severity: inboundProfile.score >= 45 ? "high" : "medium"
    });
  }
  if (extendedProfile && extendedProfile.score > 0) {
    graphSignals.push({
      code: "forensic_extended_provenance",
      message: "Extended on-chain provenance candidate; manual review required.",
      scoreImpact: Math.min(70, extendedProfile.score),
      source: "local_tron_usdt_index",
      confidence: extendedProfile.score >= 60 ? "high" : "medium",
      severity: extendedProfile.score >= 60 ? "high" : "medium"
    });
  }
  if (boundaryProfile) {
    graphSignals.push({
      code: "forensic_boundary_exposure_context",
      message: "Service-boundary exposure context; manual review required.",
      scoreImpact: Math.min(15, boundaryProfile.contextScore),
      source: "forensic_route_search",
      confidence: boundaryProfile.contextScore >= 15 ? "medium" : "low",
      severity: "medium"
    });
  }
  const amlSignals: RiskSignal[] = [];
  if (stablecoinRestrictionProfile) {
    const evidence = report.rawEvidence.find((item) => "stablecoinRestrictionProfile" in item.evidenceJson) ?? null;
    amlSignals.push({
      code: "stablecoin_usdt_blacklisted",
      message: "Official TRON USDT contract blacklist state is active for this address.",
      scoreImpact: 90,
      source: "stablecoin_contract",
      confidence: "high",
      severity: "critical",
      evidenceRef: evidence?.id
    });
  }
  const behaviorSignals: RiskSignal[] = [];
  if (behaviorProfile) {
    const score = addressBehaviorEffectiveScore(behaviorProfile);
    if (score > 0) {
      behaviorSignals.push({
        code: "forensic_address_behavior",
        message: "Address behavior pattern requires manual review.",
        scoreImpact: Math.min(30, score),
        source: "forensic_route_search",
        confidence: score >= 20 ? "high" : "medium",
        severity: score >= 20 ? "high" : "medium"
      });
    }
  }

  return { graphSignals, behaviorSignals, amlSignals };
}

function deepRiskReport(report: DeepAddressForensicReport): RiskReport {
  const counterpartyProfile = topCounterpartyRiskProfile(report);
  return calculateRisk({
    subjectAddress: report.subjectAddress,
    labels: counterpartyProfile
      ? [{
          address: report.subjectAddress,
          label: "darknet_exchange_proximity",
          source: "system",
          createdByTelegramId: null,
          createdAt: new Date(counterpartyProfile.firstTransferAt)
        }]
      : [],
    ...riskSignalsFromDeepReport(report)
  });
}

function fastRiskSnapshot(job: ForensicCheckJob): FastRiskSnapshot {
  const value = job.progressJson.fastRiskSnapshot;
  if (!isRecord(value)) return { score: 0, level: "LOW" };
  const score = typeof value.score === "number" && Number.isFinite(value.score)
    ? Math.max(0, Math.min(100, Math.round(value.score)))
    : 0;
  const level = isRiskLevel(value.level) ? value.level : "LOW";
  return { score, level };
}

function riskDeltaLabel(current: RiskReport, previous: FastRiskSnapshot): "risk increased" | "risk confirmed" | "risk changed" {
  if (current.score > previous.score || riskLevelRank[current.level] > riskLevelRank[previous.level]) return "risk increased";
  if (current.score === previous.score || current.level === previous.level) return "risk confirmed";
  return "risk changed";
}

function deepFindingLine(report: DeepAddressForensicReport): string | null {
  const path = topInboundPath(report);
  const counterpartyProfile = topCounterpartyRiskProfile(report);
  if (activeStablecoinRestrictionProfile(report)) return "New deep finding: official TRON USDT blacklist state is active.";
  if (firstApprovalDrainProfile(report)) return "New deep finding: exact approval-drain provenance found.";
  if (topExtendedProvenanceProfile(report)?.score) return "New deep finding: extended local-index provenance candidate found.";
  if (path?.label === "darknet_exchange") return "New deep finding: confirmed 2-hop exposure to known darknet exchange seed.";
  if (path) return `New deep finding: inbound provenance candidate from ${path.label} source.`;
  if (counterpartyProfile) return "New deep finding: direct exposure to a high-risk counterparty.";
  if (firstBoundaryExposureProfile(report) && firstWalletRoleProfile(report)) return "New deep finding: service-boundary exposure and wallet-role context found.";
  if (firstBoundaryExposureProfile(report)) return "New deep finding: service-boundary exposure context found.";
  if (firstServiceExposureProfile(report)) return "New deep finding: service exposure context confirmed.";
  if (addressBehaviorSignalLines(report).length > 0) return "New deep finding: address behavior context confirmed.";
  return "New deep finding: no additional risk signal found.";
}

function whatChangedLines(report: DeepAddressForensicReport, status: "completed" | "partial"): string[] {
  const profile = report.inboundProvenanceProfiles[0] ?? null;
  const path = topInboundPath(report);
  const lines: string[] = [];
  if (activeStablecoinRestrictionProfile(report)) {
    const stablecoinProfile = activeStablecoinRestrictionProfile(report);
    const balance = stablecoinProfile?.balanceRaw ? ` Current blocked balance: ${formatRawUsdt(stablecoinProfile.balanceRaw)}.` : "";
    lines.push(`Deep analysis confirmed active TRON USDT blacklist state directly from the token contract.${balance}`);
  } else if (firstApprovalDrainProfile(report)) {
    const approvalProfile = firstApprovalDrainProfile(report);
    if (approvalProfile) {
      lines.push(`Deep analysis found an exact approval-drain root: approval ${shortIdentifier(approvalProfile.approvalTxHash)} was followed by transferFrom drain ${shortIdentifier(approvalProfile.drainTxHash)}, then funds linked to this address within ${approvalProfile.hopDepth} hop(s).`);
    }
  } else if (topExtendedProvenanceProfile(report)?.score) {
    const extended = topExtendedProvenanceProfile(report);
    const top = extended?.paths.find((candidate) => candidate.evidenceStrength === "exact_labeled_path") ?? extended?.paths[0];
    if (extended && top) {
      lines.push(`Extended local-index search found a ${top.depth}-hop ${extended.direction} candidate with ${formatPercent(top.amountPreservationRatio)} amount preservation.`);
    }
  } else if (profile && path?.label === "darknet_exchange") {
    lines.push(`Deep analysis found that ${formatRawUsdt(profile.matchedInboundVolumeRaw)} of inbound volume has exact on-chain upstream exposure to a manually verified darknet exchange seed.`);
  } else if (profile && path) {
    lines.push(`Deep analysis found that ${formatRawUsdt(profile.matchedInboundVolumeRaw)} of inbound volume has upstream exposure to a labeled source.`);
  } else {
    const counterpartyProfile = topCounterpartyRiskProfile(report);
    if (counterpartyProfile) {
      lines.push(`Deep analysis found that ${formatRawUsdt(counterpartyProfile.amountRaw)} of ${counterpartyProfile.direction} volume is directly connected to a high-risk counterparty label.`);
    } else if (firstBoundaryExposureProfile(report) && firstWalletRoleProfile(report)) {
      const role = firstWalletRoleProfile(report)?.primaryRole ?? "unknown";
      lines.push(`Deep analysis found service-boundary exposure and classified the likely wallet role as ${role}.`);
    } else if (firstBoundaryExposureProfile(report)) {
      lines.push("Deep analysis found service-boundary exposure where public-chain continuity becomes limited.");
    } else if (firstServiceExposureProfile(report) || addressBehaviorSignalLines(report).length > 0) {
      lines.push("Deep analysis confirmed the preliminary service/behavior signals.");
    } else {
      lines.push("Deep analysis did not find additional risk signals in the collected evidence.");
    }
  }
  if (status === "partial" || report.missingChecks.length > 0) {
    lines.push("Deep analysis completed with limited coverage.");
  }
  return lines;
}

function evidenceLines(report: DeepAddressForensicReport): string[] {
  const path = topInboundPath(report);
  const stablecoinProfile = activeStablecoinRestrictionProfile(report);
  if (stablecoinProfile) {
    return [
      `${bold("Token")}: ${code(stablecoinProfile.tokenSymbol)} (${code(stablecoinProfile.tokenStandard)})`,
      `${bold("Contract")}: ${code(stablecoinProfile.tokenContract)}`,
      `${bold("Blacklist method")}: ${code(stablecoinProfile.methods.blacklist)} returned ${code("true")}`,
      `${bold("Balance")}: ${code(stablecoinProfile.balanceRaw ? formatRawUsdt(stablecoinProfile.balanceRaw) : "not checked")}`,
      stablecoinProfile.blacklistEventTxHash
        ? `${bold("Blacklist event")}: ${code(stablecoinProfile.blacklistEventTxHash)}`
        : `${bold("Blacklist event")}: ${code("timeline unavailable")}`,
      `${bold("Checked at")}: ${code(stablecoinProfile.checkedAt)}`
    ];
  }
  const approvalDrainProfile = firstApprovalDrainProfile(report);
  if (approvalDrainProfile) {
    return [
      approvalDrainRiskLine(approvalDrainProfile),
      `${bold("Path")}: ${code(approvalDrainProfile.pathAddresses.map(shortIdentifier).join(" -> "))}`,
      `${bold("Amount")}: ${code(formatRawUsdt(approvalDrainProfile.amountRaw))}; ${bold("preservation")}: ${code(formatPercent(approvalDrainProfile.amountPreservationRatio))}`,
      `${bold("Approval tx")}: ${code(shortIdentifier(approvalDrainProfile.approvalTxHash))}; ${bold("drain tx")}: ${code(shortIdentifier(approvalDrainProfile.drainTxHash))}`,
      `${bold("Spender")}: ${code(shortIdentifier(approvalDrainProfile.spenderAddress))}; ${bold("first receiver")}: ${code(shortIdentifier(approvalDrainProfile.firstReceiverAddress))}`,
      `${bold("Time")}: ${code(`${approvalDrainProfile.approvalAt} -> ${approvalDrainProfile.drainAt}`)}`,
      `${bold("Tx evidence")}: ${code(approvalDrainProfile.pathTxHashes.map(shortIdentifier).join(" -> "))}`,
      `${bold("Subject USDT")}: ${code(approvalDrainProfile.subjectTokenState?.balanceRaw ? formatRawUsdt(approvalDrainProfile.subjectTokenState.balanceRaw) : "not checked")}`,
      `${bold("Victim USDT")}: ${code(approvalDrainProfile.victimTokenState?.balanceRaw ? formatRawUsdt(approvalDrainProfile.victimTokenState.balanceRaw) : "not checked")}`
    ];
  }
  const extendedProfile = topExtendedProvenanceProfile(report);
  const extendedPath = extendedProfile?.paths.find((candidate) => candidate.evidenceStrength === "exact_labeled_path" && candidate.candidateScore > 0) ?? null;
  if (extendedProfile && extendedPath) {
    return [
      `${bold("Extended provenance")}: ${formatRiskIcon(levelFromScore(extendedProfile.score))} ${code(`${extendedProfile.score}/100`)} (${escapeHtml(levelFromScore(extendedProfile.score))})`,
      `${bold("Direction")}: ${code(extendedProfile.direction)}; ${bold("Depth")}: ${code(String(extendedPath.depth))}`,
      `${bold("Path")}: ${code(extendedPath.pathAddresses.map(shortIdentifier).join(" -> "))}`,
      `${bold("Amount")}: ${code(formatRawUsdt(extendedPath.amountRaw))}; ${bold("preservation")}: ${code(formatPercent(extendedPath.amountPreservationRatio))}`,
      `${bold("Label")}: ${code(extendedPath.label ?? "none")}`,
      `${bold("Tx evidence")}: ${code(extendedPath.txHashes.map(shortIdentifier).join(" -> "))}`
    ];
  }
  if (!path) {
    const counterpartyProfile = topCounterpartyRiskProfile(report);
    if (!counterpartyProfile) return boundaryExposureEvidenceLines(report);
    return [
      `${bold("Counterparty")}: ${code(counterpartyProfile.counterpartyAddress)}`,
      `${bold("Direction")}: ${code(counterpartyProfile.direction)}; ${bold("Label")}: ${code(counterpartyProfile.label ?? "unknown")}`,
      `${bold("Amount")}: ${code(formatRawUsdt(counterpartyProfile.amountRaw))}; ${bold("share")}: ${code(formatPercent(counterpartyProfile.volumeRatio))}`,
      `${bold("Time")}: ${code(`${counterpartyProfile.firstTransferAt} -> ${counterpartyProfile.lastTransferAt}`)}`,
      `${bold("Tx evidence")}: ${code(counterpartyProfile.txHashes.map(shortIdentifier).join(" -> "))}`
    ];
  }
  return [
    `${bold("Path")}: ${code([path.sourceAddress, ...path.viaAddresses, report.subjectAddress].map(shortIdentifier).join(" -> "))}`,
    `${bold("Amount")}: ${code(formatRawUsdt(path.amountRaw))}; ${bold("preservation")}: ${code(formatPercent(path.amountPreservationRatio))}`,
    `${bold("Time")}: ${code(`${path.firstTransferAt} -> ${path.lastTransferAt}`)}`,
    `${bold("Tx evidence")}: ${code(path.txHashes.map(shortIdentifier).join(" -> "))}`
  ];
}

function otherContextLines(report: DeepAddressForensicReport): string[] {
  return [
    ...extendedProvenanceSignalLines(report),
    ...serviceExposureSignalLines(report),
    ...boundaryExposureSignalLines(report),
    ...walletRoleSignalLines(report),
    ...addressBehaviorSignalLines(report)
  ].slice(0, 4);
}

function coverageLimitLines(report: DeepAddressForensicReport, status: "completed" | "partial"): string[] {
  return [
    `${report.coverage.transferEdges} transfer edges scanned; ${report.coverage.inboundSendersExpanded} inbound senders checked.`,
    report.coverage.extendedFetchedAddresses ? `${report.coverage.extendedFetchedAddresses} local-index addresses checked by extended search.` : null,
    ...limitLines(report, { deepStatus: status })
  ].filter((line): line is string => Boolean(line));
}

function formatManualReport(result: ManualCheckResult, options: { deepJob?: ForensicCheckJob | null } = {}): TelegramHtmlMessage {
  const deepQueued = Boolean(options.deepJob);
  return telegramHtmlMessage([
    bold(deepQueued ? "\u{1F50E} Address check — preliminary" : "\u{1F50E} Address check"),
    `${bold("Subject")}: ${code(result.subjectAddress)}`,
    options.deepJob ? `${bold("Deep analysis queued")}: ${code(options.deepJob.id)}` : null,
    riskLine(result.report),
    stablecoinRestrictionEvidenceLines(result).length > 0 ? bold("Exact token-contract evidence") : null,
    stablecoinRestrictionEvidenceLines(result).length > 0 ? bulletList(stablecoinRestrictionEvidenceLines(result)) : null,
    bold("What this means"),
    ...meaningLines(result, { deepQueued }),
    bold("Key signals"),
    bulletList(keySignalLines(result)),
    bold("Limits"),
    bulletList(limitLines(result, { deepQueued }), "No major coverage limits reported.")
  ].filter((line): line is string => Boolean(line)));
}

function formatForensicJobStatus(job: ForensicCheckJob | null): TelegramHtmlMessage {
  if (!job) return telegramHtmlMessage(["Deep forensic job not found."]);
  return telegramHtmlMessage([
    bold("Deep forensic status"),
    `${bold("Job")}: ${code(job.id)}`,
    `${bold("Subject")}: ${code(job.subjectAddress)}`,
    `${bold("Status")}: ${code(job.status)}`,
    `${bold("Window")}: ${code(`${job.windowStart.toISOString()} -> ${job.windowEnd.toISOString()}`)}`,
    job.lastError ? `${bold("Last error")}: ${escapeHtml(job.lastError)}` : null
  ].filter((line): line is string => Boolean(line)));
}

export function formatDeepForensicReport(
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial"
): TelegramHtmlMessage {
  const finalRisk = deepRiskReport(report);
  const previousRisk = fastRiskSnapshot(job);
  const delta = riskDeltaLabel(finalRisk, previousRisk);
  const findingLine = deepFindingLine(report);
  return telegramHtmlMessage([
    bold(`\u{1F9ED} Deep forensic result — ${delta}`),
    `${bold("Job")}: ${code(job.id)}`,
    `${bold("Subject")}: ${code(report.subjectAddress)}`,
    riskLine(finalRisk),
    `${bold("Previous fast risk")}: ${formatRiskIcon(previousRisk.level)} ${code(`${previousRisk.score}/100`)} (${escapeHtml(previousRisk.level)})`,
    stablecoinRestrictionEvidenceLines(report).length > 0 ? bold("Exact token-contract evidence") : null,
    stablecoinRestrictionEvidenceLines(report).length > 0 ? bulletList(stablecoinRestrictionEvidenceLines(report)) : null,
    findingLine,
    bold("What changed"),
    ...whatChangedLines(report, status),
    bold("Most important evidence"),
    ...(evidenceLines(report).length > 0 ? evidenceLines(report) : [bulletList([], "No exact provenance path found.")]),
    bold("Other context"),
    bulletList(otherContextLines(report), "No additional service/behavior context found."),
    bold("Coverage and limits"),
    bulletList(coverageLimitLines(report, status))
  ].filter((line): line is string => Boolean(line)));
}

function commandText(value: string | undefined): string {
  return (value ?? "").trim();
}

function parseAlertMode(value: string | undefined): CustomerAlertMode | null {
  if (!value) return "suspicious_only";
  if (value === "suspicious") return "suspicious_only";
  if (value === "all" || value === "suspicious_only") return value;
  return null;
}

function parseAlertAdminInput(
  text: string,
  ownerTelegramUserId: string,
  defaultMode: CustomerAlertMode = "suspicious_only"
): { recipientTelegramUserId: string; alertMode: CustomerAlertMode } | { error: string } {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  const recipientTelegramUserId = parts[0] ?? "";
  const alertMode = parseAlertMode(parts[1]) ?? (parts[1] ? null : defaultMode);

  if (parts.length === 0 || parts.length > 2 || !telegramIdPattern.test(recipientTelegramUserId) || !alertMode) {
    return { error: "Send a numeric Telegram ID, optionally followed by all or suspicious_only." };
  }

  if (recipientTelegramUserId === ownerTelegramUserId) {
    return { error: "You already receive owner alerts. Add a different Telegram ID." };
  }

  return { recipientTelegramUserId, alertMode };
}

function parseAlertAdminRemoveInput(text: string, ownerTelegramUserId: string): { recipientTelegramUserId: string } | { error: string } {
  const recipientTelegramUserId = text.trim();
  if (!telegramIdPattern.test(recipientTelegramUserId)) {
    return { error: "Send a numeric Telegram ID." };
  }

  if (recipientTelegramUserId === ownerTelegramUserId) {
    return { error: "The wallet owner cannot be removed from owner alerts." };
  }

  return { recipientTelegramUserId };
}

function parseWalletModeInput(
  text: string
):
  | { address: string; alertMode: WalletAlertMode; digestIntervalMinutes: number }
  | { error: string } {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  const input = classifyInput(parts[0] ?? "");
  const alertMode = parts[1] as WalletAlertMode | undefined;

  if (parts.length < 2 || parts.length > 3 || input.kind !== "tron_address" || !alertMode || !allowedWalletAlertModes.has(alertMode)) {
    return { error: "Usage: /wallet_mode <TRON-address> <realtime|risk_only|digest|paused> [minutes]" };
  }

  if (alertMode !== "digest" && parts[2]) {
    return { error: "Digest interval can only be set for digest mode." };
  }

  const digestIntervalMinutes = alertMode === "digest" ? Number(parts[2] ?? "10") : 10;
  if (!Number.isSafeInteger(digestIntervalMinutes) || digestIntervalMinutes < 5 || digestIntervalMinutes > 60) {
    return { error: "Digest interval must be between 5 and 60 minutes." };
  }

  return { address: input.value, alertMode, digestIntervalMinutes };
}

async function replyOrEdit(ctx: Context, message: BotMessage, keyboard?: InlineKeyboard): Promise<void> {
  const text = messageText(message);
  const options = messageOptions(message, keyboard);
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, options);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const normalizedMessage = message.toLowerCase();
      if (normalizedMessage.includes("message is not modified")) {
        return;
      }
      if (
        !normalizedMessage.includes("message to edit not found") &&
        !normalizedMessage.includes("message can't be edited") &&
        !normalizedMessage.includes("message cannot be edited")
      ) {
        throw error;
      }
      await ctx.reply(text, options);
      return;
    }
  }
  await ctx.reply(text, options);
}

async function ensureTelegramUser(ctx: Context, db: Db): Promise<string> {
  const id = telegramId(ctx);
  await upsertTelegramUser(db, {
    telegramUserId: id,
    username: ctx.from?.username ?? null
  });
  return id;
}

async function answerCallbackQuerySafely(ctx: Context): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("query is too old")) return;
    throw error;
  }
}

async function replyWithCheck(
  input: string,
  ctx: { reply(text: string, options?: BotSendOptions): Promise<unknown>; chat?: { id: number | string } },
  tronClient: TronClient,
  db: Db,
  getAddressRiskSignalsForAddress?: (address: string) => Promise<ManualRiskSignals>,
  options: {
    telegramUserId?: string | null;
    queueDeepForensicJob?: CreateBotOptions["queueDeepForensicJob"];
  } = {}
): Promise<void> {
  const classified = classifyInput(input);

  if (classified.kind === "tron_address") {
    const result = await checkAddress(classified.value, {
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getRiskSignalsForAddress: getAddressRiskSignalsForAddress,
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation)
    });
    const deepJob = await options.queueDeepForensicJob?.({
      subjectAddress: classified.value,
      chatId: ctx.chat?.id === undefined ? null : String(ctx.chat.id),
      requestedBy: options.telegramUserId ?? null,
      fastRiskSnapshot: {
        score: result.report.score,
        level: result.report.level
      }
    }).catch(() => null);
    await sendMessage(ctx, formatManualReport(result, { deepJob }));
    return;
  }

  if (classified.kind === "tron_tx") {
    try {
      const result = await checkTransactionHash(classified.value, {
        tronClient,
        getLabelsForAddress: (address) => listAddressLabels(db, address),
        recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation)
      });
      await sendMessage(ctx, formatManualReport(result));
    } catch (error) {
      console.error("Manual transaction check failed", error);
      await ctx.reply("Could not extract an official TRC20 USDT sender from this transaction.");
    }
    return;
  }

  await ctx.reply("Usage: /check <TRON-address-or-tx-hash>");
}

async function getOwnedWallet(db: Db, telegramUserId: string, walletId: string): Promise<WatchedWallet | null> {
  const wallets = await listWatchedWallets(db, telegramUserId);
  return wallets.find((wallet) => wallet.id === walletId) ?? null;
}

async function buildWalletDashboard(
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient,
  wallet: WatchedWallet,
  forceRefresh = false
) {
  return getWalletDashboard(
    {
      tronClient,
      config,
      getSnapshot: (watchedWalletId) => getWalletDashboardSnapshot(db, watchedWalletId),
      upsertSnapshot: (snapshot) => upsertWalletDashboardSnapshot(db, snapshot),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getPollState: (watchedWalletId) => getWalletPollState(db, watchedWalletId),
      getApprovalSummary: (watchedWalletId) => getWalletApprovalSummary(db, watchedWalletId)
    },
    { wallet, forceRefresh }
  );
}

async function showWalletDashboard(
  ctx: Context,
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient,
  wallet: WatchedWallet,
  forceRefresh = false
): Promise<void> {
  const dashboard = await buildWalletDashboard(config, db, tronClient, wallet, forceRefresh);
  await replyOrEdit(ctx, dashboardMessage(dashboard), walletDashboardKeyboard(wallet.id));
}

async function showWalletList(ctx: Context, db: Db, telegramUserId: string): Promise<void> {
  const wallets = await listWatchedWallets(db, telegramUserId);
  await replyOrEdit(ctx, walletsMessage(wallets.length), walletsKeyboard(wallets));
}

async function showSettings(ctx: Context, db: Db, telegramUserId: string): Promise<void> {
  const recipients = await listCustomerAlertRecipients(db, telegramUserId);
  await replyOrEdit(ctx, settingsMessage(recipients), settingsKeyboard());
}

async function showProfile(ctx: Context, db: Db, telegramUserId: string): Promise<void> {
  const wallets = await listWatchedWallets(db, telegramUserId);
  await replyOrEdit(
    ctx,
    profileMessage({
      telegramUserId,
      username: ctx.from?.username ?? null,
      walletCount: wallets.length
    }),
    profileKeyboard()
  );
}

async function showAlertAdmins(ctx: Context, db: Db, telegramUserId: string): Promise<void> {
  const recipients = await listCustomerAlertRecipients(db, telegramUserId);
  await replyOrEdit(ctx, alertAdminsMessage(recipients), alertAdminsKeyboard(recipients));
}

async function customerAlertRecipientExists(db: Db, ownerTelegramUserId: string, recipientTelegramUserId: string): Promise<boolean> {
  const recipients = await listCustomerAlertRecipients(db, ownerTelegramUserId);
  return recipients.some((recipient) => recipient.recipientTelegramUserId === recipientTelegramUserId);
}

async function addAlertAdminAndShow(
  ctx: Context,
  db: Db,
  ownerTelegramUserId: string,
  text: string,
  defaultMode: CustomerAlertMode = "suspicious_only",
  options: { requireExisting?: boolean } = {}
): Promise<void> {
  const input = parseAlertAdminInput(text, ownerTelegramUserId, defaultMode);
  if ("error" in input) {
    await setTelegramUserPendingAction(db, { telegramUserId: ownerTelegramUserId, pendingAction: "add_alert_admin" });
    await ctx.reply(input.error, { reply_markup: cancelKeyboard() });
    return;
  }

  if (options.requireExisting && !(await customerAlertRecipientExists(db, ownerTelegramUserId, input.recipientTelegramUserId))) {
    await clearTelegramUserPendingAction(db, ownerTelegramUserId);
    await sendMessage(
      ctx,
      alertAdminNotFoundMessage(input.recipientTelegramUserId),
      alertAdminsKeyboard(await listCustomerAlertRecipients(db, ownerTelegramUserId))
    );
    return;
  }

  await addCustomerAlertRecipient(db, {
    ownerTelegramUserId,
    recipientTelegramUserId: input.recipientTelegramUserId,
    alertMode: input.alertMode
  });
  await clearTelegramUserPendingAction(db, ownerTelegramUserId);
  const recipients = await listCustomerAlertRecipients(db, ownerTelegramUserId);
  await sendMessage(
    ctx,
    combineMessages([
      alertAdminAddedMessage({ telegramUserId: input.recipientTelegramUserId, mode: input.alertMode }),
      alertAdminsMessage(recipients)
    ]),
    alertAdminsKeyboard(recipients)
  );
}

async function removeAlertAdminAndShow(
  ctx: Context,
  db: Db,
  ownerTelegramUserId: string,
  text: string
): Promise<void> {
  const input = parseAlertAdminRemoveInput(text, ownerTelegramUserId);
  if ("error" in input) {
    await setTelegramUserPendingAction(db, { telegramUserId: ownerTelegramUserId, pendingAction: "remove_alert_admin" });
    await ctx.reply(input.error, { reply_markup: cancelKeyboard() });
    return;
  }

  const removed = await removeCustomerAlertRecipient(db, {
    ownerTelegramUserId,
    recipientTelegramUserId: input.recipientTelegramUserId
  });
  await clearTelegramUserPendingAction(db, ownerTelegramUserId);
  const recipients = await listCustomerAlertRecipients(db, ownerTelegramUserId);
  await sendMessage(
    ctx,
    combineMessages([
      removed ? alertAdminRemovedMessage(input.recipientTelegramUserId) : alertAdminNotFoundMessage(input.recipientTelegramUserId),
      alertAdminsMessage(recipients)
    ]),
    alertAdminsKeyboard(recipients)
  );
}

async function addWalletAndShowDashboard(
  ctx: Context,
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient,
  telegramUserId: string,
  address: string
): Promise<void> {
  const wallet = await addWatchedWallet(db, { telegramUserId, address });
  await clearTelegramUserPendingAction(db, telegramUserId);
  await showWalletDashboard(ctx, config, db, tronClient, wallet);
}

export function createBot(
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient & Partial<TronApprovalClient>,
  options: CreateBotOptions = {}
): Bot {
  const bot = new Bot(config.botToken);
  const getAddressRiskSignalsForAddress = options.getAddressRiskSignalsForAddress ?? createAddressExposureRiskSignalProvider({
    tronClient,
    getAddressMetadata: (address, now) => getAddressMetadata(db, address, now),
    upsertAddressMetadata: (metadata) => upsertAddressMetadata(db, metadata),
    getContractIntelligenceProfile: (address, now) => getContractIntelligenceProfile(db, address, now),
    upsertContractIntelligenceProfile: (profile) => upsertContractIntelligenceProfile(db, profile)
  }, {
    pageLimit: config.tronscanPageLimit
  });
  const queueDeepForensicJob = options.queueDeepForensicJob ?? ((input: {
    subjectAddress: string;
    chatId: string | null;
    requestedBy: string | null;
    fastRiskSnapshot?: FastRiskSnapshot;
  }) => {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    return createOrReuseForensicCheckJob(db, {
      subjectAddress: input.subjectAddress,
      windowStart,
      windowEnd,
      chatId: input.chatId,
      requestedBy: input.requestedBy,
      priority: 100,
      progressJson: input.fastRiskSnapshot ? { fastRiskSnapshot: input.fastRiskSnapshot } : {}
    });
  });
  const resolveForensicCheckJob = options.getForensicCheckJob ?? ((id: string) => getForensicCheckJob(db, id));

  bot.catch((error) => {
    console.error("Telegram bot update failed", error.error);
  });

  bot.command("start", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const wallets = await listWatchedWallets(db, id);
    await sendMessage(ctx, homeMessage(wallets.length), mainMenuKeyboard());
  });

  bot.command("help", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await sendMessage(ctx, helpMessage(), mainMenuKeyboard());
  });

  bot.command("settings", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showSettings(ctx, db, id);
  });

  bot.command("profile", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showProfile(ctx, db, id);
  });

  bot.command("my_id", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await sendMessage(ctx, myIdMessage({ telegramUserId: id, username: ctx.from?.username ?? null }), mainMenuKeyboard());
  });

  bot.command("alert_admins", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showAlertAdmins(ctx, db, id);
  });

  bot.command("alert_recipients", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showAlertAdmins(ctx, db, id);
  });

  bot.command("add_alert_admin", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_alert_admin" });
      await sendMessage(ctx, addAlertAdminPrompt(), cancelKeyboard());
      return;
    }
    await addAlertAdminAndShow(ctx, db, id, input);
  });

  bot.command("alert_add", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_alert_admin" });
      await sendMessage(ctx, addAlertAdminPrompt(), cancelKeyboard());
      return;
    }
    await addAlertAdminAndShow(ctx, db, id, input);
  });

  bot.command("remove_alert_admin", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "remove_alert_admin" });
      await sendMessage(ctx, removeAlertAdminPrompt(), cancelKeyboard());
      return;
    }
    await removeAlertAdminAndShow(ctx, db, id, input);
  });

  bot.command("alert_remove", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "remove_alert_admin" });
      await sendMessage(ctx, removeAlertAdminPrompt(), cancelKeyboard());
      return;
    }
    await removeAlertAdminAndShow(ctx, db, id, input);
  });

  bot.command("alert_mode", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = commandText(ctx.match);
    const parts = input.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length !== 2) {
      await clearTelegramUserPendingAction(db, id);
      await ctx.reply("Usage: /alert_mode <telegram-id> <suspicious|suspicious_only|all>", { reply_markup: alertAdminsKeyboard(await listCustomerAlertRecipients(db, id)) });
      return;
    }
    await addAlertAdminAndShow(ctx, db, id, input, "suspicious_only", { requireExisting: true });
  });

  bot.command("wallet_mode", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const input = parseWalletModeInput(commandText(ctx.match));
    if ("error" in input) {
      await ctx.reply(input.error);
      return;
    }

    const wallets = await listWatchedWallets(db, id);
    const wallet = wallets.find((item) => item.address === input.address);
    if (!wallet) {
      await ctx.reply(`Wallet not found: ${input.address}`, { reply_markup: mainMenuKeyboard() });
      return;
    }

    await updateWatchedWalletAlertMode(db, {
      telegramUserId: id,
      address: input.address,
      alertMode: input.alertMode,
      digestIntervalMinutes: input.digestIntervalMinutes
    });
    const updatedWallet = {
      ...wallet,
      alertMode: input.alertMode,
      digestIntervalMinutes: input.digestIntervalMinutes
    };
    await sendMessage(ctx, walletAlertModeUpdatedMessage(updatedWallet), walletAlertModeKeyboard(updatedWallet));
  });

  bot.command("add_wallet", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = classifyInput(commandText(ctx.match));

    if (input.kind !== "tron_address") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_wallet" });
      await sendMessage(ctx, addWalletPrompt(), cancelKeyboard());
      return;
    }

    await addWalletAndShowDashboard(ctx, config, db, tronClient, id, input.value);
  });

  bot.command("wallets", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showWalletList(ctx, db, id);
  });

  bot.command("remove_wallet", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const input = classifyInput(commandText(ctx.match));
    if (input.kind !== "tron_address") {
      await ctx.reply("Usage: /remove_wallet <TRON-address>");
      return;
    }

    const removed = await removeWatchedWallet(db, { telegramUserId: id, address: input.value });
    await ctx.reply(removed ? `Removed wallet: ${input.value}` : `Wallet not found: ${input.value}`, {
      reply_markup: mainMenuKeyboard()
    });
  });

  bot.command("check", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await replyWithCheck(commandText(ctx.match), ctx, tronClient, db, getAddressRiskSignalsForAddress, {
      telegramUserId: id,
      queueDeepForensicJob
    });
  });

  bot.command("check_status", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const jobId = commandText(ctx.match);
    if (!jobId) {
      await ctx.reply("Usage: /check_status <deep-job-id>");
      return;
    }
    await sendMessage(ctx, formatForensicJobStatus(await resolveForensicCheckJob(jobId)));
  });

  bot.command("labels", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }
    await ctx.reply(ALLOWED_LABELS.map((label) => `- ${label}`).join("\n"));
  });

  bot.command("admin_users", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }
    const adminIds = [...config.serviceAdminTelegramIds].sort();
    await ctx.reply(adminIds.length ? adminIds.map((adminId) => `- ${adminId}`).join("\n") : "No service admins configured.");
  });

  bot.command("mark", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }

    const args = commandText(ctx.match).split(/\s+/).filter((part) => part.length > 0);
    const [rawAddress, rawLabel] = args;
    const input = classifyInput(rawAddress ?? "");
    const label = rawLabel as RiskLabel;
    if (args.length !== 2 || input.kind !== "tron_address" || !allowedLabelSet.has(label)) {
      await ctx.reply("Usage: /mark <TRON-address> <label>");
      return;
    }

    await saveAddressLabel(db, {
      address: input.value,
      label,
      source: "service_admin",
      createdByTelegramId: id
    });
    await ctx.reply(`Marked ${input.value} as ${label}.`);
  });

  bot.command("recheck_safety", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }

    const args = commandText(ctx.match).split(/\s+/).filter((part) => part.length > 0);
    const walletInput = classifyInput(args[0] ?? "");
    if (args.length < 1 || args.length > 2 || walletInput.kind !== "tron_address") {
      await ctx.reply("Usage: /recheck_safety <wallet_address> [spender_or_approval_tx]");
      return;
    }

    const summary = await runSafetyRecheck({
      db,
      tronClient: tronClient as TronApprovalClient,
      walletAddress: walletInput.value,
      target: parseSafetyRecheckTarget(args[1]),
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet
    });
    await ctx.reply(formatSafetyRecheckSummary(summary));
  });

  bot.on("callback_query:data", async (ctx) => {
    const id = telegramId(ctx);
    await answerCallbackQuerySafely(ctx);
    await upsertTelegramUser(db, {
      telegramUserId: id,
      username: ctx.from?.username ?? null
    });

    const callback = parseCallbackData(ctx.callbackQuery.data);
    if (!callback) {
      await replyOrEdit(ctx, "Unknown action.", mainMenuKeyboard());
      return;
    }

    if (callback.kind === "home") {
      await clearTelegramUserPendingAction(db, id);
      const wallets = await listWatchedWallets(db, id);
      await replyOrEdit(ctx, homeMessage(wallets.length), mainMenuKeyboard());
      return;
    }

    if (callback.kind === "help") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, helpMessage(), mainMenuKeyboard());
      return;
    }

    if (callback.kind === "profile") {
      await clearTelegramUserPendingAction(db, id);
      await showProfile(ctx, db, id);
      return;
    }

    if (callback.kind === "risk_overview") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, riskIntelOverviewMessage(), mainMenuKeyboard());
      return;
    }

    if (callback.kind === "wallets_list") {
      await clearTelegramUserPendingAction(db, id);
      await showWalletList(ctx, db, id);
      return;
    }

    if (callback.kind === "wallet_add") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_wallet" });
      await replyOrEdit(ctx, addWalletPrompt(), cancelKeyboard());
      return;
    }

    if (callback.kind === "check_address") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "check_address" });
      await replyOrEdit(ctx, checkAddressPrompt(), cancelKeyboard());
      return;
    }

    if (callback.kind === "check_tx") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "check_tx" });
      await replyOrEdit(ctx, checkTxPrompt(), cancelKeyboard());
      return;
    }

    if (callback.kind === "check_address_value") {
      await clearTelegramUserPendingAction(db, id);
      await replyWithCheck(callback.address, ctx, tronClient, db, getAddressRiskSignalsForAddress, {
        telegramUserId: id,
        queueDeepForensicJob
      });
      return;
    }

    if (callback.kind === "settings") {
      await clearTelegramUserPendingAction(db, id);
      await showSettings(ctx, db, id);
      return;
    }

    if (callback.kind === "settings_alerts") {
      await clearTelegramUserPendingAction(db, id);
      await showAlertAdmins(ctx, db, id);
      return;
    }

    if (callback.kind === "settings_add_admin") {
      const pendingAction =
        callback.alertMode === "all"
          ? "add_alert_admin_all"
          : callback.alertMode === "suspicious_only"
            ? "add_alert_admin_suspicious_only"
            : "add_alert_admin";
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction });
      await replyOrEdit(ctx, addAlertAdminPrompt(callback.alertMode ?? "suspicious_only"), cancelKeyboard());
      return;
    }

    if (callback.kind === "settings_remove_admin") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "remove_alert_admin" });
      await replyOrEdit(ctx, removeAlertAdminPrompt(), cancelKeyboard());
      return;
    }

    if (callback.kind === "settings_remove_admin_value") {
      await removeAlertAdminAndShow(ctx, db, id, callback.recipientTelegramUserId);
      return;
    }

    if (callback.kind === "cancel") {
      await clearTelegramUserPendingAction(db, id);
      const wallets = await listWatchedWallets(db, id);
      await replyOrEdit(ctx, homeMessage(wallets.length), mainMenuKeyboard());
      return;
    }

    const wallet = await getOwnedWallet(db, id, callback.walletId);
    if (!wallet) {
      await replyOrEdit(ctx, "Wallet not found.", mainMenuKeyboard());
      return;
    }

    if (callback.kind === "wallet_view") {
      await clearTelegramUserPendingAction(db, id);
      await showWalletDashboard(ctx, config, db, tronClient, wallet);
      return;
    }

    if (callback.kind === "wallet_refresh") {
      await clearTelegramUserPendingAction(db, id);
      await showWalletDashboard(ctx, config, db, tronClient, wallet, true);
      return;
    }

    if (callback.kind === "wallet_analytics") {
      await clearTelegramUserPendingAction(db, id);
      const dashboard = await buildWalletDashboard(config, db, tronClient, wallet);
      await replyOrEdit(ctx, analyticsMessage(dashboard), backToWalletKeyboard(wallet.id));
      return;
    }

    if (callback.kind === "wallet_risk") {
      await clearTelegramUserPendingAction(db, id);
      const dashboard = await buildWalletDashboard(config, db, tronClient, wallet);
      await replyOrEdit(ctx, securityMessage(dashboard), backToWalletKeyboard(wallet.id));
      return;
    }

    if (callback.kind === "wallet_safety") {
      await clearTelegramUserPendingAction(db, id);
      const dashboard = await buildWalletDashboard(config, db, tronClient, wallet);
      await replyOrEdit(ctx, safetyMessage(dashboard), backToWalletKeyboard(wallet.id));
      return;
    }

    if (callback.kind === "wallet_alert_mode") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, walletAlertModeMessage(wallet), walletAlertModeKeyboard(wallet));
      return;
    }

    if (callback.kind === "wallet_alert_mode_set") {
      await clearTelegramUserPendingAction(db, id);
      const digestIntervalMinutes =
        callback.alertMode === "digest" ? callback.digestIntervalMinutes : wallet.digestIntervalMinutes;
      await updateWatchedWalletAlertMode(db, {
        telegramUserId: id,
        address: wallet.address,
        alertMode: callback.alertMode,
        digestIntervalMinutes
      });
      await showWalletDashboard(ctx, config, db, tronClient, {
        ...wallet,
        alertMode: callback.alertMode,
        digestIntervalMinutes
      });
      return;
    }

    if (callback.kind === "wallet_remove") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, removeConfirmMessage(wallet.address), walletRemoveKeyboard(wallet.id));
      return;
    }

    if (callback.kind === "wallet_remove_confirm") {
      await clearTelegramUserPendingAction(db, id);
      await removeWatchedWallet(db, { telegramUserId: id, address: wallet.address });
      await showWalletList(ctx, db, id);
    }
  });

  bot.on("message:text", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const text = ctx.message.text.trim();
    const session = await getTelegramUserSession(db, id);

    if (shouldHandlePendingText(session, text)) {
      const input = classifyInput(text);

      if (session.pendingAction === "add_wallet") {
        if (input.kind !== "tron_address") {
          await ctx.reply("Send a valid TRON wallet address.", { reply_markup: cancelKeyboard() });
          return;
        }
        await addWalletAndShowDashboard(ctx, config, db, tronClient, id, input.value);
        return;
      }

      if (session.pendingAction === "check_address") {
        if (input.kind !== "tron_address") {
          await ctx.reply("Send a valid TRON address.", { reply_markup: cancelKeyboard() });
          return;
        }
        await clearTelegramUserPendingAction(db, id);
        await replyWithCheck(input.value, ctx, tronClient, db, getAddressRiskSignalsForAddress, {
          telegramUserId: id,
          queueDeepForensicJob
        });
        return;
      }

      if (session.pendingAction === "check_tx") {
        if (input.kind !== "tron_tx") {
          await ctx.reply("Send a valid TRON transaction hash.", { reply_markup: cancelKeyboard() });
          return;
        }
        await clearTelegramUserPendingAction(db, id);
        await replyWithCheck(input.value, ctx, tronClient, db, getAddressRiskSignalsForAddress, {
          telegramUserId: id,
          queueDeepForensicJob
        });
        return;
      }

      if (session.pendingAction === "add_alert_admin") {
        await addAlertAdminAndShow(ctx, db, id, text);
        return;
      }

      if (session.pendingAction === "add_alert_admin_all") {
        await addAlertAdminAndShow(ctx, db, id, text, "all");
        return;
      }

      if (session.pendingAction === "add_alert_admin_suspicious_only") {
        await addAlertAdminAndShow(ctx, db, id, text, "suspicious_only");
        return;
      }

      if (session.pendingAction === "remove_alert_admin") {
        await removeAlertAdminAndShow(ctx, db, id, text);
        return;
      }
    }

    const input = classifyInput(text);
    if (input.kind === "tron_address") {
      await addWalletAndShowDashboard(ctx, config, db, tronClient, id, input.value);
      return;
    }

    if (input.kind === "tron_tx") {
      await replyWithCheck(input.value, ctx, tronClient, db, getAddressRiskSignalsForAddress, {
        telegramUserId: id,
        queueDeepForensicJob
      });
      return;
    }

    await ctx.reply("Send a TRON address to monitor it, or use /check <TRON-address-or-tx-hash>.", {
      reply_markup: mainMenuKeyboard()
    });
  });

  return bot;
}
