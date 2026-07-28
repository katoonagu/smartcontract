import type { Schema037Verification } from "../storage/schemaMigrations";

export async function runStartupSchemaGate(input: {
  verify: () => Promise<Schema037Verification>;
  onVerified: (verification: Schema037Verification) => void;
}): Promise<Schema037Verification> {
  const verification = await input.verify();
  input.onVerified(verification);
  return verification;
}
