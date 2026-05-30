import type { RiskConfidence } from "../types";
import { matchServiceRouteRegistry, matchServiceRouteRegistryPhrase, serviceRoutePolicyBounds, type ServiceRouteCategory } from "./serviceRouteRegistry";

export type { ServiceRouteCategory } from "./serviceRouteRegistry";

export type ApprovalDrainProofFacts = {
  approveFound: boolean;
  transferFromConfirmed: boolean;
  spenderMatched: boolean;
};

export type ServiceRouteEvidenceKind =
  | "layerzero_oft_delivery"
  | "known_service_route"
  | "dex_router_boundary"
  | "unknown_service_route"
  | "none";

export type ServiceRouteEvidence = {
  kind: ServiceRouteEvidenceKind;
  confidence: RiskConfidence;
  category: ServiceRouteCategory | null;
  identity: string | null;
  policyRiskFloor: number;
  policyRiskCeiling: number;
  drainProof: "not_proven" | "possible" | "proven";
  guardCodes: string[];
  signals: string[];
  contracts: Array<{
    address: string;
    name: string | null;
    tag: string | null;
    isContract: boolean | null;
  }>;
};

export type ExtractServiceRouteEvidenceInput = {
  subjectAddress: string;
  transactionInfo: unknown;
  contractProfile?: unknown;
  approvalDrainProof?: ApprovalDrainProofFacts;
};

type ContractSummary = ServiceRouteEvidence["contracts"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function lower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function hasKnownCexIdentity(text: string): boolean {
  return hasAny(text, [
    "binance",
    "bybit",
    "okx",
    "whitebit",
    "coinbase",
    "kraken",
    "kucoin",
    "bitget",
    "mexc",
    "bitstamp",
    "htx",
    "huobi",
    "crypto.com",
    "cryptocom"
  ]);
}

function addressEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && lower(left) === lower(right));
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectValues(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, item]) => {
    if (isRecord(item)) return { address: key, ...item };
    return { address: key, value: item };
  });
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function firstBoolean(record: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = booleanValue(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function contractFromRecord(record: Record<string, unknown>): ContractSummary | null {
  const address = firstString(record, ["address", "contractAddress", "contract_address", "owner_address"]);
  if (!address) return null;
  return {
    address,
    name: firstString(record, ["name", "contractName", "contract_name", "tag1", "tokenName"]),
    tag: firstString(record, ["tag", "tagName", "publicTag", "public_tag", "label"]),
    isContract: firstBoolean(record, ["isContract", "contract", "is_contract"])
  };
}

function mergeContract(existing: ContractSummary, incoming: ContractSummary): ContractSummary {
  return {
    address: existing.address,
    name: existing.name ?? incoming.name,
    tag: existing.tag ?? incoming.tag,
    isContract: existing.isContract ?? incoming.isContract
  };
}

function collectContracts(tx: Record<string, unknown>, contractProfile: unknown): ContractSummary[] {
  const contracts = new Map<string, ContractSummary>();
  const add = (contract: ContractSummary | null) => {
    if (!contract) return;
    const key = lower(contract.address);
    const current = contracts.get(key);
    contracts.set(key, current ? mergeContract(current, contract) : contract);
  };

  for (const item of arrayValue(tx.contractInfo)) {
    if (isRecord(item)) add(contractFromRecord(item));
  }
  for (const item of objectValues(tx.contractInfo)) {
    if (isRecord(item)) add(contractFromRecord(item));
  }
  for (const item of objectValues(tx.contract_map)) {
    if (isRecord(item)) {
      const contract = contractFromRecord(item);
      const mappedIsContract = booleanValue(item.value);
      add(contract ? { ...contract, isContract: contract.isContract ?? mappedIsContract ?? true } : null);
    }
  }
  if (isRecord(contractProfile)) add(contractFromRecord(contractProfile));

  return Array.from(contracts.values());
}

function textFromInput(tx: Record<string, unknown>, contractProfile: unknown, contracts: ContractSummary[]): string {
  return [
    JSON.stringify(tx.contractInfo ?? ""),
    JSON.stringify(tx.contract_map ?? ""),
    JSON.stringify(tx.trigger_info ?? ""),
    JSON.stringify(tx.trc20TransferInfo ?? ""),
    JSON.stringify(tx.tokenTransferInfo ?? ""),
    JSON.stringify(contractProfile ?? ""),
    contracts.map((contract) => [contract.name, contract.tag].filter(Boolean).join(" ")).join(" ")
  ].join(" ");
}

function transferAddress(record: Record<string, unknown>, keys: string[]): string | null {
  return firstString(record, keys);
}

function isUsdtTransfer(record: Record<string, unknown>): boolean {
  const tokenInfo = isRecord(record.tokenInfo) ? record.tokenInfo : {};
  const tokenText = [
    firstString(record, ["symbol", "tokenSymbol", "tokenAbbr"]),
    firstString(record, ["name", "tokenName"]),
    firstString(record, ["contract_address", "contractAddress"]),
    firstString(tokenInfo, ["symbol", "tokenSymbol", "tokenAbbr"]),
    firstString(tokenInfo, ["name", "tokenName"]),
    firstString(tokenInfo, ["tokenId", "token_id", "contract_address", "contractAddress"])
  ].filter(Boolean).join(" ").toLowerCase();
  return tokenText.includes("usdt") || tokenText.includes("tether");
}

function tokenTransferItems(tx: Record<string, unknown>): unknown[] {
  return [
    ...arrayValue(tx.trc20TransferInfo),
    ...arrayValue(tx.tokenTransferInfo)
  ];
}

function incomingUsdtFromContract(input: {
  tx: Record<string, unknown>;
  subjectAddress: string;
  contracts: ContractSummary[];
}): { found: boolean; fromAddress: string | null; fromIsContract: boolean } {
  const contractAddresses = new Set(input.contracts.filter((contract) => contract.isContract === true).map((contract) => lower(contract.address)));
  for (const item of tokenTransferItems(input.tx)) {
    if (!isRecord(item) || !isUsdtTransfer(item)) continue;
    const toAddress = transferAddress(item, ["to_address", "toAddress", "to"]);
    if (!addressEqual(toAddress, input.subjectAddress)) continue;
    const fromAddress = transferAddress(item, ["from_address", "fromAddress", "from"]);
    const fromIsContract =
      (fromAddress ? contractAddresses.has(lower(fromAddress)) : false) ||
      firstBoolean(item, ["from_is_contract", "fromIsContract"]) === true;
    return { found: true, fromAddress, fromIsContract };
  }
  return { found: false, fromAddress: null, fromIsContract: false };
}

function drainProofStatus(proof: ApprovalDrainProofFacts | null | undefined): ServiceRouteEvidence["drainProof"] {
  if (proof?.transferFromConfirmed === true && proof.spenderMatched === true) return "proven";
  if (proof?.approveFound === true || proof?.transferFromConfirmed === true || proof?.spenderMatched === true) return "possible";
  return "not_proven";
}

function noneEvidence(contracts: ContractSummary[], drainProof: ServiceRouteEvidence["drainProof"]): ServiceRouteEvidence {
  return {
    kind: "none",
    confidence: "low",
    category: null,
    identity: null,
    policyRiskFloor: 0,
    policyRiskCeiling: 0,
    drainProof,
    guardCodes: [],
    signals: [],
    contracts
  };
}

export function extractServiceRouteEvidence(input: ExtractServiceRouteEvidenceInput): ServiceRouteEvidence {
  const tx = isRecord(input.transactionInfo) ? input.transactionInfo : {};
  const contracts = collectContracts(tx, input.contractProfile);
  const text = textFromInput(tx, input.contractProfile, contracts);
  const lowerText = text.toLowerCase();
  const incoming = incomingUsdtFromContract({ tx, subjectAddress: input.subjectAddress, contracts });
  const drainProof = drainProofStatus(input.approvalDrainProof);
  const noConfirmedDrain = drainProof !== "proven";
  const endpointPresent = lowerText.includes("layerzero") && (lowerText.includes("endpoint") || lowerText.includes("endpointv2"));
  const executorPresent = lowerText.includes("executor");
  const oftPresent = lowerText.includes("usdtoft") || lowerText.includes("usdt oft") || lowerText.includes("omnichain fungible token") || /\boft\b/.test(lowerText);

  if (incoming.found && incoming.fromIsContract && endpointPresent && executorPresent && oftPresent) {
    const guardCodes = ["usdt_from_address_is_contract", "layerzero_endpoint_present", "oft_contract_present"];
    if (noConfirmedDrain) guardCodes.push("no_confirmed_approval_drain");
    const policyBounds = serviceRoutePolicyBounds("cross_chain_bridge");
    return {
      kind: "layerzero_oft_delivery",
      confidence: "high",
      category: "cross_chain_bridge",
      identity: "LayerZero/OFT",
      policyRiskFloor: policyBounds.policyRiskFloor,
      policyRiskCeiling: policyBounds.policyRiskCeiling,
      drainProof,
      guardCodes,
      signals: ["layerzero_endpoint", "layerzero_executor", "oft_contract", "incoming_usdt_to_subject"],
      contracts
    };
  }

  const phraseRegistryMatch = matchServiceRouteRegistryPhrase(text);
  const registryMatch = matchServiceRouteRegistry(text);
  const cexGenericKeywordOnlyMatch =
    registryMatch &&
    !phraseRegistryMatch &&
    hasKnownCexIdentity(lowerText) &&
    (
      (registryMatch.canonicalName === "LayerZero/OFT" && hasAny(lowerText, ["endpoint", "executor"])) ||
      (registryMatch.canonicalName === "Axelar" && hasAny(lowerText, ["gateway", "gas service"])) ||
      (registryMatch.canonicalName === "GasFree" && lowerText.includes("endpoint"))
    );

  if (registryMatch && !cexGenericKeywordOnlyMatch) {
    const dexRoute = registryMatch.category === "dex_router_or_swap_aggregator";
    const guardCodes = ["service_route_boundary_present"];
    if (incoming.found && incoming.fromIsContract) guardCodes.push("usdt_from_address_is_contract");
    if (noConfirmedDrain) guardCodes.push("no_confirmed_approval_drain");
    return {
      kind: dexRoute ? "dex_router_boundary" : "known_service_route",
      confidence: incoming.found || contracts.length > 0 ? "medium" : "low",
      category: registryMatch.category,
      identity: registryMatch.canonicalName,
      policyRiskFloor: registryMatch.policyRiskFloor,
      policyRiskCeiling: registryMatch.policyRiskCeiling,
      drainProof,
      guardCodes,
      signals: [`service_route:${registryMatch.category}`, `service_route_identity:${registryMatch.canonicalName}`],
      contracts
    };
  }

  if (incoming.found && incoming.fromIsContract && noConfirmedDrain) {
    const policyBounds = serviceRoutePolicyBounds("unknown_service_route");
    return {
      kind: "unknown_service_route",
      confidence: "medium",
      category: "unknown_service_route",
      identity: incoming.fromAddress,
      policyRiskFloor: policyBounds.policyRiskFloor,
      policyRiskCeiling: policyBounds.policyRiskCeiling,
      drainProof,
      guardCodes: ["usdt_from_address_is_contract", "unknown_service_route_present", "no_confirmed_approval_drain"],
      signals: ["incoming_usdt_to_subject", "unknown_contract_sender"],
      contracts
    };
  }

  return noneEvidence(contracts, drainProof);
}
