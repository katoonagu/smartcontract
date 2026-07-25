import type { Schema035Verification } from "../storage/schemaMigrations";

export async function runStartupSchemaGate(input: {
  verify: () => Promise<Schema035Verification>;
  onVerified: (verification: Schema035Verification) => void;
}): Promise<Schema035Verification> {
  const verification = await input.verify();
  input.onVerified(verification);
  return verification;
}
