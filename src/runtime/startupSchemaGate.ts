import type { Schema033Verification } from "../storage/schemaMigrations";

export async function runStartupSchemaGate(input: {
  verify: () => Promise<Schema033Verification>;
  onVerified: (verification: Schema033Verification) => void;
}): Promise<Schema033Verification> {
  const verification = await input.verify();
  input.onVerified(verification);
  return verification;
}
