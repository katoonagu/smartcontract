import type { Schema036Verification } from "../storage/schemaMigrations";

export async function runStartupSchemaGate(input: {
  verify: () => Promise<Schema036Verification>;
  onVerified: (verification: Schema036Verification) => void;
}): Promise<Schema036Verification> {
  const verification = await input.verify();
  input.onVerified(verification);
  return verification;
}
