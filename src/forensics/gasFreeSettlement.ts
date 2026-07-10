import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ForensicRouteEdge } from "../types";

export type GasFreeMovementRole = "principal" | "service_fee";
export type GasFreeSettlementMovement = {
  role: GasFreeMovementRole;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
};
export type GasFreeSettlement = {
  protocol: "tron_gasfree";
  controllerVersion: "permit_transfer_v1";
  controllerAddress: string;
  accountAddress: string;
  userAddress: string;
  receiverAddress: string;
  principalAmountRaw: string;
  maxFeeRaw: string;
  serviceFeeAmountRaw: string;
  grossDebitAmountRaw: string;
  movements: GasFreeSettlementMovement[];
  evidenceStrength: "exact";
  evidenceCodes: string[];
};

const CONTROLLERS = new Map([
  ["tffamqlzybalalb4uxha9rbe7pxhuajf3u", {
    version: "permit_transfer_v1" as const,
    selectors: new Set(["6f21b898"])
  }]
]);
const TRANSFER_LIST_KEYS = [
  "trc20TransferInfo", "trc20TransferInfoList", "tokenTransferInfo",
  "tokenTransferInfoList", "transfersAllList", "transfers"
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(source: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function normalizedAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const address = value.trim();

  try {
    const hex = /^41[0-9a-fA-F]{40}$/.test(address)
      ? address
      : /^0x[0-9a-fA-F]{40}$/.test(address)
        ? `41${address.slice(2)}`
        : TronWeb.address.toHex(address);
    if (!/^41[0-9a-fA-F]{40}$/.test(hex)) return null;
    const canonical = TronWeb.address.fromHex(hex);
    return typeof canonical === "string" ? canonical : null;
  } catch {
    return null;
  }
}

function addressWord(word: string): string | null {
  return /^0{24}[0-9a-fA-F]{40}$/.test(word)
    ? normalizedAddress(`41${word.slice(-40)}`)
    : null;
}

function uintWord(word: string): bigint | null {
  if (!/^[0-9a-fA-F]{64}$/.test(word)) return null;
  try {
    return BigInt(`0x${word}`);
  } catch {
    return null;
  }
}

function selectedTransfers(transaction: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of TRANSFER_LIST_KEYS) {
    const rows = transaction[key];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    return rows.map(record).filter((row): row is Record<string, unknown> => row !== null);
  }
  return [];
}

function rowToken(row: Record<string, unknown>): string | null {
  const tokenInfo = record(row.tokenInfo) ?? record(row.token_info);
  return text(row, "contract_address", "contractAddress", "token_id", "tokenId")
    ?? text(tokenInfo, "tokenId", "token_id");
}

function rowAmount(row: Record<string, unknown>): string | null {
  return text(row, "amount_str", "amountStr", "quant", "amount", "value", "rawAmount");
}

function sameAddress(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizedAddress(left);
  const normalizedRight = normalizedAddress(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft === normalizedRight;
}

function hasSuccessfulResult(transaction: Record<string, unknown>): boolean {
  let found = false;
  for (const key of ["contractRet", "contract_ret", "finalResult"] as const) {
    const value = transaction[key];
    if (value === undefined || value === null || (typeof value === "string" && value.trim().length === 0)) continue;
    if (typeof value !== "string" || value.trim().toUpperCase() !== "SUCCESS") return false;
    found = true;
  }
  return found;
}

export function extractGasFreeSettlement(transactionInfo: unknown): GasFreeSettlement | null {
  const transaction = record(transactionInfo);
  if (!transaction || transaction.confirmed !== true || transaction.revert === true || !hasSuccessfulResult(transaction)) {
    return null;
  }

  const contractData = record(transaction.contractData) ?? record(transaction.contract_data);
  const controllerAddress = normalizedAddress(text(contractData, "contract_address", "contractAddress"));
  if (!contractData || !controllerAddress) return null;

  const controller = CONTROLLERS.get(controllerAddress.toLowerCase());
  const rawData = text(contractData, "data");
  const data = rawData?.replace(/^0x/i, "") ?? "";
  const signatureByteLength = 65;
  const paddedSignatureByteLength = Math.ceil(signatureByteLength / 32) * 32;
  const expectedDataLength = 8 + 64 * 9 + 64 + paddedSignatureByteLength * 2;
  if (
    !controller ||
    data.length !== expectedDataLength ||
    !/^[0-9a-fA-F]+$/.test(data)
  ) {
    return null;
  }

  const selector = data.slice(0, 8).toLowerCase();
  if (!controller.selectors.has(selector)) return null;

  const words = Array.from({ length: 9 }, (_, index) => data.slice(8 + index * 64, 8 + (index + 1) * 64));
  const tokenAddress = addressWord(words[0]);
  const userAddress = addressWord(words[1]);
  const receiverAddress = addressWord(words[2]);
  const value = uintWord(words[3]);
  const maxFee = uintWord(words[4]);
  const signatureOffset = uintWord(words[8]);
  const signatureLength = uintWord(data.slice(8 + 64 * 9, 8 + 64 * 10));
  const signatureTail = data.slice(8 + 64 * 10);
  const signaturePadding = signatureTail.slice(signatureByteLength * 2);
  if (
    !tokenAddress ||
    !userAddress ||
    !receiverAddress ||
    value === null ||
    maxFee === null ||
    signatureOffset !== BigInt(9 * 32) ||
    signatureLength !== BigInt(signatureByteLength) ||
    signaturePadding !== "0".repeat((paddedSignatureByteLength - signatureByteLength) * 2) ||
    !sameAddress(tokenAddress, TRON_USDT_CONTRACT_ADDRESS)
  ) {
    return null;
  }

  const transferRows = selectedTransfers(transaction)
    .filter((row) => sameAddress(rowToken(row), TRON_USDT_CONTRACT_ADDRESS));
  if (transferRows.length === 0) return null;

  let accountAddress: string | null = null;
  const movements: GasFreeSettlementMovement[] = [];
  for (const row of transferRows) {
    const fromAddress = normalizedAddress(text(row, "from_address", "fromAddress", "from"));
    const toAddress = normalizedAddress(text(row, "to_address", "toAddress", "to"));
    const amountRaw = rowAmount(row);
    if (!fromAddress || !toAddress || !amountRaw || !/^\d+$/.test(amountRaw)) return null;
    if (accountAddress !== null && accountAddress !== fromAddress) return null;
    accountAddress ??= fromAddress;
    movements.push({
      role: sameAddress(toAddress, receiverAddress) ? "principal" : "service_fee",
      fromAddress,
      toAddress,
      amountRaw
    });
  }
  if (!accountAddress) return null;

  let principal = 0n;
  let serviceFee = 0n;
  for (const movement of movements) {
    const amount = BigInt(movement.amountRaw);
    if (movement.role === "principal") principal += amount;
    else serviceFee += amount;
  }
  if (principal !== value || serviceFee > maxFee) return null;

  return {
    protocol: "tron_gasfree",
    controllerVersion: controller.version,
    controllerAddress,
    accountAddress,
    userAddress,
    receiverAddress,
    principalAmountRaw: value.toString(),
    maxFeeRaw: maxFee.toString(),
    serviceFeeAmountRaw: serviceFee.toString(),
    grossDebitAmountRaw: (value + serviceFee).toString(),
    movements,
    evidenceStrength: "exact",
    evidenceCodes: [
      "gasfree_controller_registered",
      "gasfree_permit_transfer",
      "gasfree_value_and_fee_balanced"
    ]
  };
}

export function gasFreeMovementForEdge(
  settlement: GasFreeSettlement,
  edge: Pick<ForensicRouteEdge, "fromAddress" | "toAddress" | "amountRaw">
): GasFreeSettlementMovement | null {
  return settlement.movements.find((movement) =>
    movement.amountRaw === edge.amountRaw &&
    sameAddress(movement.fromAddress, edge.fromAddress) &&
    sameAddress(movement.toAddress, edge.toAddress)
  ) ?? null;
}

export function extractGasFreeEdgeContext(
  transactionInfo: unknown,
  edge: Pick<ForensicRouteEdge, "fromAddress" | "toAddress" | "amountRaw">
): { settlement: GasFreeSettlement; movement: GasFreeSettlementMovement } | null {
  const settlement = extractGasFreeSettlement(transactionInfo);
  if (!settlement) return null;
  const movement = gasFreeMovementForEdge(settlement, edge);
  return movement ? { settlement, movement } : null;
}

export function isGasFreeServiceFeeEdge(
  edge: Pick<ForensicRouteEdge, "economicRole" | "economicProtocol">
): boolean {
  return edge.economicProtocol === "tron_gasfree" && edge.economicRole === "service_fee";
}
