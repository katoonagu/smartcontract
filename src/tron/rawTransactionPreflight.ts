import { TronWeb } from "tronweb";

export type RawTransactionPreflightV1 =
  | {
      status: "parsed";
      contractType: string;
      contractAddress: string;
      selector: string;
      callerAddress: string;
      recipientAddress: string | null;
      amountRaw: string | null;
      successful: boolean;
      rawContractCount: number;
    }
  | { status: "ambiguous"; reason: string };

const TRIGGER_SMART_CONTRACT_TYPE = "TriggerSmartContract";
const TRIGGER_SMART_CONTRACT_TYPE_URL = "type.googleapis.com/protocol.TriggerSmartContract";
const TRANSFER_SELECTOR = "a9059cbb";
const TRANSFER_FROM_SELECTOR = "23b872dd";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function ambiguity(reason: string): RawTransactionPreflightV1 {
  return { status: "ambiguous", reason };
}

function tronAddressFromHex(value: unknown): string | null {
  if (typeof value !== "string" || !/^41[0-9a-f]{40}$/i.test(value)) return null;
  try {
    const address = TronWeb.address.fromHex(value.toLowerCase());
    return TronWeb.isAddress(address) ? address : null;
  } catch {
    return null;
  }
}

function abiAddress(word: string): string | null {
  if (!/^0{24}[0-9a-f]{40}$/.test(word)) return null;
  return tronAddressFromHex(`41${word.slice(24)}`);
}

function abiUint256(word: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(word)) return null;
  try {
    return BigInt(`0x${word}`).toString(10);
  } catch {
    return null;
  }
}

export function parseRawTransactionPreflightV1(value: unknown): RawTransactionPreflightV1 {
  const transaction = record(value);
  const rawData = record(transaction?.raw_data);
  const contracts = rawData?.contract;
  if (!Array.isArray(contracts)) return ambiguity("missing_raw_contracts");
  if (contracts.length !== 1) return ambiguity(`raw_contract_count_${contracts.length}`);

  const contract = record(contracts[0]);
  if (!contract || typeof contract.type !== "string" || contract.type.length === 0) {
    return ambiguity("missing_contract_type");
  }
  if (contract.type !== TRIGGER_SMART_CONTRACT_TYPE) return ambiguity("unsupported_contract_type");

  const parameter = record(contract.parameter);
  if (!parameter) return ambiguity("missing_contract_parameter");
  if (parameter.type_url !== TRIGGER_SMART_CONTRACT_TYPE_URL) return ambiguity("unsupported_contract_parameter_type");
  const trigger = record(parameter.value);
  if (!trigger) return ambiguity("missing_contract_parameter_value");

  const callerAddress = tronAddressFromHex(trigger.owner_address);
  if (!callerAddress) return ambiguity("missing_caller_address");
  const contractAddress = tronAddressFromHex(trigger.contract_address);
  if (!contractAddress) return ambiguity("missing_contract_address");

  if (typeof trigger.data !== "string" || !/^[0-9a-f]+$/i.test(trigger.data)) {
    return ambiguity("malformed_calldata");
  }
  const data = trigger.data.toLowerCase();
  if (data.length < 8 || (data.length - 8) % 64 !== 0) return ambiguity("malformed_calldata");
  const selector = data.slice(0, 8);

  let recipientAddress: string | null = null;
  let amountRaw: string | null = null;
  if (selector === TRANSFER_SELECTOR) {
    if (data.length !== 8 + 64 * 2) return ambiguity("short_transfer_calldata");
    recipientAddress = abiAddress(data.slice(8, 72));
    amountRaw = abiUint256(data.slice(72, 136));
    if (!recipientAddress || amountRaw === null) return ambiguity("invalid_transfer_calldata");
  } else if (selector === TRANSFER_FROM_SELECTOR) {
    if (data.length !== 8 + 64 * 3) return ambiguity("short_transfer_from_calldata");
    recipientAddress = abiAddress(data.slice(72, 136));
    amountRaw = abiUint256(data.slice(136, 200));
    if (!recipientAddress || amountRaw === null) return ambiguity("invalid_transfer_from_calldata");
  }

  const results = transaction?.ret;
  if (!Array.isArray(results) || results.length !== 1) return ambiguity("missing_contract_result");
  const result = record(results[0]);
  if (!result || typeof result.contractRet !== "string" || result.contractRet.trim().length === 0) {
    return ambiguity("missing_contract_result");
  }

  return {
    status: "parsed",
    contractType: contract.type,
    contractAddress,
    selector,
    callerAddress,
    recipientAddress,
    amountRaw,
    successful: result.contractRet.toUpperCase() === "SUCCESS",
    rawContractCount: contracts.length
  };
}
