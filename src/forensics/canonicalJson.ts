import { createHash } from "node:crypto";

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_JSON_STRING_LENGTH = 4_096;
const MAX_CANONICAL_JSON_DEPTH = 64;
const MAX_CANONICAL_JSON_NODES = 10_000;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalizeJson(value: unknown): string {
  let nodeCount = 0;
  const activeObjects = new WeakSet<object>();

  const visit = (item: unknown, depth: number): string => {
    nodeCount += 1;
    if (nodeCount > MAX_CANONICAL_JSON_NODES) {
      throw new RangeError("Canonical JSON exceeds node limit");
    }
    if (depth > MAX_CANONICAL_JSON_DEPTH) {
      throw new RangeError("Canonical JSON exceeds depth limit");
    }
    if (typeof item === "string") {
      if (item.length > MAX_JSON_STRING_LENGTH) {
        throw new RangeError("Canonical JSON string exceeds length limit");
      }
      return JSON.stringify(item);
    }
    if (item === null || typeof item === "boolean") {
      return JSON.stringify(item);
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("Canonical JSON requires finite numbers");
      return JSON.stringify(item);
    }
    if (typeof item !== "object") {
      throw new TypeError("Canonical JSON contains an unsupported value");
    }
    if (activeObjects.has(item)) throw new TypeError("Canonical JSON cannot contain cycles");

    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype) {
        throw new TypeError("Canonical JSON requires ordinary arrays");
      }
      const ownKeys = Reflect.ownKeys(item);
      if (nodeCount + item.length > MAX_CANONICAL_JSON_NODES) {
        throw new RangeError("Canonical JSON exceeds node limit");
      }
      if (ownKeys.length !== item.length + 1
        || !ownKeys.every((key) => key === "length"
          || (typeof key === "string"
            && /^(0|[1-9][0-9]*)$/.test(key)
            && Number(key) < item.length))) {
        throw new TypeError("Canonical JSON arrays must be dense and contain no extra properties");
      }
      const descriptors = Object.getOwnPropertyDescriptors(item);
      for (let index = 0; index < item.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError("Canonical JSON arrays must be dense data properties");
        }
      }
      activeObjects.add(item);
      try {
        return `[${item.map((entry) => visit(entry, depth + 1)).join(",")}]`;
      } finally {
        activeObjects.delete(item);
      }
    }

    if (!isPlainRecord(item)) {
      throw new TypeError("Canonical JSON requires plain objects");
    }
    const ownKeys = Reflect.ownKeys(item);
    if (nodeCount + ownKeys.length > MAX_CANONICAL_JSON_NODES) {
      throw new RangeError("Canonical JSON exceeds node limit");
    }
    if (!ownKeys.every((key) => typeof key === "string")) {
      throw new TypeError("Canonical JSON objects require string keys");
    }
    if ((ownKeys as string[]).some((key) => key.length > MAX_IDENTIFIER_LENGTH)) {
      throw new RangeError("Canonical JSON object key exceeds length limit");
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of ownKeys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Canonical JSON objects require enumerable data properties");
      }
    }
    activeObjects.add(item);
    try {
      const keys = (ownKeys as string[])
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
      return `{${keys
        .map((key) => `${JSON.stringify(key)}:${visit(descriptors[key]!.value, depth + 1)}`)
        .join(",")}}`;
    } finally {
      activeObjects.delete(item);
    }
  };

  return visit(value, 0);
}

export function fingerprintCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}
