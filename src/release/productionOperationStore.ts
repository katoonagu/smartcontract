import { existsSync, readFileSync } from "node:fs";
import { canonicalBytesV2, safeArtifactPath, unlinkDurable, writeExclusiveDurable } from "./releaseRootWriterStore";
import { releaseSha256V2 } from "./remediationReleaseManifestV2";

export const PRODUCTION_OPERATION_LEASE_FILE_V2 = "production-operation-root.lease.json";

export type ProductionOperationStoreRecordV2 = Readonly<{
  kind: string;
  relativePath: string;
  sha256: string;
}>;

export class ProductionOperationStoreV2 {
  readonly #root: string;

  constructor(root: string) { this.#root = root; }

  persistExclusive(kind: string, relativePath: string, value: unknown): ProductionOperationStoreRecordV2 {
    const path = safeArtifactPath(this.#root, relativePath);
    const bytes = canonicalBytesV2(value);
    if (existsSync(path)) {
      if (!readFileSync(path).equals(bytes)) throw new Error("production_operation_artifact_conflict");
    } else writeExclusiveDurable(path, bytes);
    return { kind, relativePath, sha256: releaseSha256V2(bytes) };
  }

  acquireLease(value: unknown): ProductionOperationStoreRecordV2 {
    return this.persistExclusive("production_operation_lease", PRODUCTION_OPERATION_LEASE_FILE_V2, value);
  }

  releaseLease(expectedSha256: string): void {
    const path = safeArtifactPath(this.#root, PRODUCTION_OPERATION_LEASE_FILE_V2);
    if (!existsSync(path)) throw new Error("production_operation_lease_missing");
    if (releaseSha256V2(readFileSync(path)) !== expectedSha256) throw new Error("production_operation_lease_fence_invalid");
    unlinkDurable(path);
  }
}
