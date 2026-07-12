export const OFFICIAL_TRON_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export const THJ_POISONING_CASE = {
  watchedWallet: "THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7",
  realRecipient: "THDppXpzBV14Wp9o47zkDRjpLvZSCd58Fg",
  lookalike: "TABPfWW3Q7vCnfPQgQ8BCpjHqFqhCd58Fg",
  outgoingTxHash: "8c70cadc7128323239873d886e0c20ae6feb1d6096c951159c3517793e16d44f",
  incomingTxHash: "2c973bca918030e1ed0f49f4e69192368837c050398dc980fabf8ae2cdecbb4e",
  outgoingAt: new Date("2026-07-01T12:46:57.000Z"),
  incomingAt: new Date("2026-07-01T12:47:42.000Z"),
  amountRaw: "10000000",
  tokenContract: OFFICIAL_TRON_USDT_CONTRACT,
  tokenDecimals: 6
} as const;

export const THJ_POST_LOSS_FACTS = {
  lossTxHash: "976f0e1609cf0721a9026995e1ccc238b1110ee56c0485c4038226e5ff6c2df7",
  lossAmountRaw: "282693000000",
  psmTxHash: "2fc22b7b5a0da88e506864aa7c073af863ca18fee4116017229d5be296612be4e"
} as const;
