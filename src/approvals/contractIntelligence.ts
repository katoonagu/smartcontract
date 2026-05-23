import type { RiskReport } from "../types";
import type {
  TronContractProfileClient,
  TronscanContractDetail,
  TronscanContractListItem,
  TronscanContractProviderTag,
  TronscanContractPublicTag,
  TronscanContractSearchResult,
  TronscanContractTopCallStats
} from "../tron/tronClient";

export const CONTRACT_INTELLIGENCE_POLICY_VERSION = "2026-05-23-unknown-drainer-contract-v1";
export const CONTRACT_INTELLIGENCE_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const CONTRACT_INTELLIGENCE_TTL_MS = CONTRACT_INTELLIGENCE_DEFAULT_TTL_MS;

export type ContractActivityLevel = "unknown" | "none" | "low" | "normal" | "high";

export type ContractProviderTag = TronscanContractProviderTag;
export type ContractPublicTag = TronscanContractPublicTag;

export type ContractMethodStat = {
  methodId: string;
  signature: string | null;
  count: number;
  ratio: number | null;
  method?: string;
  calls?: number | null;
  percentage?: number | null;
};

export type ContractCallerStat = {
  address: string;
  addressTag: string | null;
  count: number;
  ratio: number | null;
  calls?: number | null;
  percentage?: number | null;
};

export type ContractIntelligenceProfile = {
  contractAddress: string;
  providerTags: ContractProviderTag[];
  publicTags: ContractPublicTag[];
  isVerified: boolean | null;
  verifyStatus: number | null;
  sourceStatus: string | null;
  contractCreatedAt: Date | null;
  contractAgeDays: number | null;
  txCount: string | null;
  recentCallCount: string | null;
  totalCallCount: string | null;
  totalCallerCount: string | null;
  topMethods: ContractMethodStat[];
  topCallers: ContractCallerStat[];
  methodMap: Record<string, string>;
  providerRisk: boolean | null;
  rawPayload: Record<string, unknown>;
  fetchedAt: Date;
  expiresAt: Date;

  address?: string;
  source?: "tronscan";
  name?: string | null;
  serviceTag?: string | null;
  publicTag?: string | null;
  publicTagDesc?: string | null;
  tagUrl?: string | null;
  verified?: boolean | null;
  trxCount?: string | null;
  uniqueCallerCount?: string | null;
  hasTransferFromSelector?: boolean;
  hasOwnerOnlyPattern?: boolean;
  lowMetadata?: boolean;
  activityLevel?: ContractActivityLevel;
  rawJson?: Record<string, unknown>;
};

export type ContractRiskContext = Partial<ContractIntelligenceProfile>;

export type ResolveContractIntelligenceProfileDeps = {
  tronClient: TronContractProfileClient;
  now?: () => Date;
  ttlMs?: number;
  getCachedProfile(contractAddress: string, now: Date): Promise<ContractIntelligenceProfile | null>;
  upsertProfile(profile: ContractIntelligenceProfile): Promise<void>;
};

const serviceTagKeywords = [
  "bridge",
  "cross-chain",
  "cross chain",
  "swap",
  "router",
  "dex",
  "exchange",
  "payment",
  "energy",
  "bandwidth",
  "staking"
];

const ownerOnlyNeedles = [
  "no access",
  "caller is not the owner",
  "ownable",
  "onlyowner",
  "tokenapprove: no access"
];

function countString(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function integerFromString(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function firstDefined<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function contractAgeDays(contractCreatedAt: Date | null, now: Date): number | null {
  if (!contractCreatedAt) return null;
  const ageMs = now.getTime() - contractCreatedAt.getTime();
  if (ageMs < 0) return 0;
  return Math.floor(ageMs / (24 * 60 * 60 * 1000));
}

function dedupeProviderTags(tags: ContractProviderTag[]): ContractProviderTag[] {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = `${tag.kind}:${tag.label}:${tag.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupePublicTags(tags: ContractPublicTag[]): ContractPublicTag[] {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = `${tag.label}:${tag.description ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectSearchContract(result: TronscanContractSearchResult, contractAddress: string): TronscanContractListItem | null {
  return result.contracts.find((contract) => contract.address === contractAddress) ?? result.contracts[0] ?? null;
}

function methodName(method: ContractMethodStat): string {
  return method.signature ?? method.method ?? method.methodId;
}

function buildProfile(input: {
  contractAddress: string;
  search: TronscanContractSearchResult;
  detail: TronscanContractDetail | null;
  topCall: TronscanContractTopCallStats;
  now: Date;
  ttlMs: number;
}): ContractIntelligenceProfile {
  const listItem = selectSearchContract(input.search, input.contractAddress);
  const contractCreatedAt = firstDefined(input.detail?.contractCreatedAt, listItem?.contractCreatedAt);
  const methodMap = input.detail?.methodMap ?? {};
  const providerTags = dedupeProviderTags([...(listItem?.providerTags ?? []), ...(input.detail?.providerTags ?? [])]);
  const publicTags = dedupePublicTags([...(listItem?.publicTags ?? []), ...(input.detail?.publicTags ?? [])]);
  const topMethods = input.topCall.topMethods.map((method) => ({
    ...method,
    signature: method.signature ?? methodMap[method.methodId] ?? null,
    method: method.signature ?? methodMap[method.methodId] ?? method.methodId,
    calls: method.count,
    percentage: method.ratio
  }));
  const topCallers = input.topCall.topCallers.map((caller) => ({
    ...caller,
    calls: caller.count,
    percentage: caller.ratio
  }));
  const rawPayload = {
    contracts: input.search.rawJson,
    contract: input.detail?.rawJson ?? null,
    topCall: input.topCall.rawJson
  };
  const inspection = inspectRawContractJson({
    ...rawPayload,
    methodMap
  });
  const txCount = countString(firstDefined(input.detail?.txCount, listItem?.txCount));
  const totalCallCount = countString(input.topCall.totalCallCount);
  const totalCallerCount = countString(input.topCall.totalCallerCount);
  const activityLevel = deriveActivityLevel({
    trxCount: integerFromString(txCount),
    totalCallCount: integerFromString(totalCallCount),
    uniqueCallerCount: integerFromString(totalCallerCount),
    topMethods
  });
  const serviceTag = providerTags[0]?.label ?? null;
  const publicTag = publicTags[0]?.label ?? null;
  const publicTagDesc = publicTags[0]?.description ?? null;

  return {
    contractAddress: input.contractAddress,
    providerTags,
    publicTags,
    isVerified: firstDefined(input.detail?.verified, listItem?.verified),
    verifyStatus: firstDefined(input.detail?.verifyStatus, listItem?.verifyStatus),
    sourceStatus: firstDefined(input.detail?.sourceStatus, listItem?.sourceStatus),
    contractCreatedAt,
    contractAgeDays: contractAgeDays(contractCreatedAt, input.now),
    txCount,
    recentCallCount: countString(input.topCall.recentCallCount),
    totalCallCount,
    totalCallerCount,
    topMethods,
    topCallers,
    methodMap,
    providerRisk: firstDefined(input.detail?.providerRisk, listItem?.providerRisk),
    rawPayload,
    fetchedAt: input.now,
    expiresAt: new Date(input.now.getTime() + input.ttlMs),
    address: input.contractAddress,
    source: "tronscan",
    name: input.detail?.name ?? listItem?.name ?? null,
    serviceTag,
    publicTag,
    publicTagDesc,
    tagUrl: providerTags[0]?.url ?? null,
    verified: firstDefined(input.detail?.verified, listItem?.verified),
    trxCount: txCount,
    uniqueCallerCount: totalCallerCount,
    hasTransferFromSelector: inspection.hasTransferFromSelector,
    hasOwnerOnlyPattern: inspection.hasOwnerOnlyPattern,
    lowMetadata: inspection.lowMetadata,
    activityLevel,
    rawJson: rawPayload
  };
}

export async function resolveContractIntelligenceProfile(
  contractAddress: string,
  deps: ResolveContractIntelligenceProfileDeps
): Promise<ContractIntelligenceProfile> {
  const now = (deps.now ?? (() => new Date()))();
  const cached = await deps.getCachedProfile(contractAddress, now);
  if (cached) return cached;

  const [search, detail, topCall] = await Promise.all([
    deps.tronClient.listContracts({ search: contractAddress, limit: 1, start: 0 }),
    deps.tronClient.getContract(contractAddress),
    deps.tronClient.getContractTopCallStats(contractAddress)
  ]);
  const profile = buildProfile({
    contractAddress,
    search,
    detail,
    topCall,
    now,
    ttlMs: deps.ttlMs ?? CONTRACT_INTELLIGENCE_DEFAULT_TTL_MS
  });
  await deps.upsertProfile(profile);
  return profile;
}

export function buildContractIntelligenceRiskHints(profile: ContractIntelligenceProfile): RiskReport["reasons"] {
  const reasons: RiskReport["reasons"] = [];
  const totalCallCount = integerFromString(profile.totalCallCount);
  const totalCallerCount = integerFromString(profile.totalCallerCount);

  if (profile.providerRisk === true) {
    reasons.push({
      code: "contract_profile_provider_risk",
      message: "Provider metadata marks contract as risky",
      scoreImpact: 90,
      source: "contract_intelligence",
      confidence: "high",
      severity: "critical"
    });
  }
  if (profile.isVerified === false || profile.sourceStatus === "missing") {
    reasons.push({
      code: "contract_profile_unverified_source",
      message: "Contract source is unverified or unavailable",
      scoreImpact: 25,
      source: "contract_intelligence",
      confidence: "medium",
      severity: "medium"
    });
  }
  if (profile.contractAgeDays !== null && profile.contractAgeDays <= 7) {
    reasons.push({
      code: "contract_profile_young_contract",
      message: "Contract was created recently",
      scoreImpact: 15,
      source: "contract_intelligence",
      confidence: "medium",
      severity: "medium"
    });
  }
  if ((totalCallCount !== null && totalCallCount < 10) || (totalCallerCount !== null && totalCallerCount < 3)) {
    reasons.push({
      code: "contract_profile_low_call_history",
      message: "Contract has little observed call history",
      scoreImpact: 10,
      source: "contract_intelligence",
      confidence: "medium",
      severity: "low"
    });
  }

  return reasons;
}

export function serviceTagFromContractProfile(profile: ContractRiskContext | null | undefined): string | null {
  if (!profile || profile.providerRisk === true) return null;
  const providerTags = profile.providerTags ?? [];
  const publicTags = profile.publicTags ?? [];
  const providerText = providerTags.map((tag) => tag.label).join(" ");
  const publicText = publicTags.map((tag) => [tag.label, tag.description].filter(Boolean).join(" ")).join(" ");
  const text = [profile.serviceTag, profile.publicTag, profile.publicTagDesc, providerText, publicText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text) return null;
  const keyword = serviceTagKeywords.find((item) => text.includes(item));
  return keyword ? (profile.serviceTag ?? providerTags[0]?.label ?? profile.publicTag ?? publicTags[0]?.label ?? keyword) : null;
}

export function serviceIdentityFromContractProfile(profile: ContractRiskContext | null | undefined): string | null {
  return profile?.serviceTag ?? profile?.providerTags?.[0]?.label ?? profile?.publicTag ?? profile?.publicTags?.[0]?.label ?? serviceTagFromContractProfile(profile);
}

export function contractProfileHasServiceActivity(profile: ContractRiskContext | null | undefined): boolean {
  if (!profile) return false;
  if (profile.activityLevel === "normal" || profile.activityLevel === "high") return true;
  const methods = (profile.topMethods ?? []).map((method) => methodName(method).toLowerCase());
  return methods.some((method) => /swap|withdraw|deposit|bridge|mint|redeem|stake|unstake|addliquidity|removeliquidity/.test(method));
}

export function isSuspiciousUnknownContractProfile(profile: ContractRiskContext | null | undefined): boolean {
  if (!profile) return false;
  if (serviceTagFromContractProfile(profile)) return false;
  const verified = profile.isVerified ?? profile.verified ?? null;
  const weakIdentity = verified === false || verified === null || profile.lowMetadata === true;
  const transferCapability = profile.hasTransferFromSelector === true || profile.hasOwnerOnlyPattern === true;
  return weakIdentity && transferCapability;
}

export function contractIntelligenceReasons(profile: ContractRiskContext | null | undefined): RiskReport["reasons"] {
  if (!profile) return [];
  const reasons: RiskReport["reasons"] = [];
  const serviceIdentity = serviceIdentityFromContractProfile(profile);
  if (serviceIdentity && contractProfileHasServiceActivity(profile)) {
    reasons.push({
      code: "contract_intel_known_service_activity",
      message: `Contract intelligence identifies spender as service-like: ${serviceIdentity}`,
      scoreImpact: 0,
      source: "contract_intelligence",
      confidence: "medium",
      severity: "info"
    });
  }
  if (!serviceIdentity && profile.lowMetadata) {
    reasons.push({
      code: "contract_intel_low_metadata",
      message: "Contract has weak provider metadata and no service tag",
      scoreImpact: 10,
      source: "contract_intelligence",
      confidence: "medium",
      severity: "medium"
    });
  }
  if (!serviceIdentity && profile.hasTransferFromSelector) {
    reasons.push({
      code: "contract_intel_transferfrom_capable",
      message: "Contract bytecode/method metadata includes transferFrom capability",
      scoreImpact: 15,
      source: "contract_intelligence",
      confidence: "medium",
      severity: "high"
    });
  }
  if (!serviceIdentity && profile.hasOwnerOnlyPattern) {
    reasons.push({
      code: "contract_intel_owner_only_pull_pattern",
      message: "Contract metadata includes owner/admin-only pull pattern",
      scoreImpact: 10,
      source: "contract_intelligence",
      confidence: "medium",
      severity: "high"
    });
  }
  return reasons;
}

export function deriveActivityLevel(input: {
  trxCount: number | null;
  totalCallCount: number | null;
  uniqueCallerCount: number | null;
  topMethods: ContractMethodStat[];
}): ContractActivityLevel {
  const tx = input.trxCount ?? 0;
  const calls = input.totalCallCount ?? 0;
  const callers = input.uniqueCallerCount ?? 0;
  if (tx === 0 && calls === 0 && input.topMethods.length === 0) return "none";
  if (tx >= 100_000 || calls >= 100_000 || callers >= 10_000) return "high";
  if (tx >= 1_000 || calls >= 1_000 || callers >= 100) return "normal";
  return "low";
}

export function inspectRawContractJson(rawJson: Record<string, unknown>): {
  hasTransferFromSelector: boolean;
  hasOwnerOnlyPattern: boolean;
  lowMetadata: boolean;
} {
  const text = JSON.stringify(rawJson).toLowerCase();
  const methodMap = rawJson.methodMap;
  const methodMapSize = methodMap && typeof methodMap === "object" && !Array.isArray(methodMap)
    ? Object.keys(methodMap).length
    : 0;
  return {
    hasTransferFromSelector: text.includes("23b872dd") || text.includes("transferfrom"),
    hasOwnerOnlyPattern: ownerOnlyNeedles.some((needle) => text.includes(needle)),
    lowMetadata: methodMapSize === 0 && !text.includes("verified")
  };
}
