import { createBot } from "./bot/createBot";
import { loadConfig } from "./config";
import { runSinglePollingCycle } from "./monitor/monitorWorker";
import { createDb } from "./storage/db";
import {
  hasObservedTransaction,
  listAddressLabels,
  listWatchedWallets,
  saveObservedTransaction
} from "./storage/repositories";
import { TronscanClient } from "./tron/tronClient";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const tronClient = new TronscanClient(config.tronscanBaseUrl);
const bot = createBot(config, db, tronClient);

let polling = false;

async function sendAdminAlert(message: string): Promise<void> {
  for (const adminId of config.serviceAdminTelegramIds) {
    await bot.api.sendMessage(adminId, message);
  }
}

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;

  try {
    const wallets = await listWatchedWallets(db);
    await runSinglePollingCycle({
      wallets,
      tronClient,
      hasObservedTransaction: (txHash, watchedWalletId) => hasObservedTransaction(db, txHash, watchedWalletId),
      saveObservedTransaction: (input) => saveObservedTransaction(db, input),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      sendUserAlert: async (telegramUserId, message) => {
        await bot.api.sendMessage(telegramUserId, message);
      },
      sendAdminAlert
    });
  } finally {
    polling = false;
  }
}

setInterval(() => {
  pollOnce().catch((error) => {
    console.error("Polling cycle failed", error);
  });
}, config.pollIntervalMs);

pollOnce().catch((error) => {
  console.error("Initial polling cycle failed", error);
});

bot.start({
  onStart: () => {
    console.log("TRON USDT monitoring bot started");
  }
});
