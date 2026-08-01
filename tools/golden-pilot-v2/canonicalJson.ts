import { createHash } from "node:crypto";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function normalize(value: unknown, seen: Set<object>): Json {
  if (value === undefined) {
    throw new TypeError("golden_undefined_value");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("golden_non_finite_number");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("golden_non_json_value");
  }
  if (seen.has(value)) {
    throw new TypeError("golden_cyclic_value");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalize(item, seen));
    }
    const record = value as Record<string, unknown>;
    const result: Record<string, Json> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) {
        throw new TypeError("golden_undefined_value");
      }
      result[key] = normalize(record[key], seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()));
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}
