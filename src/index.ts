import { createBot } from "./bot/createBot";
import { loadConfig } from "./config";
import { runSinglePollingCycle } from "./monitor/monitorWorker";
import { closeDb, createDb } from "./storage/db";
import {
  hasObservedTransaction,
  listAddressLabels,
  listWatchedWallets,
  saveObservedTransaction
} from "./storage/repositories";
import { TronscanClient } from "./tron/tronClient";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const tronClient = new TronscanClient({
  baseUrl: config.tronscanBaseUrl,
  apiKey: config.tronscanApiKey
});
const bot = createBot(config, db, tronClient);

let polling = false;
let shuttingDown = false;

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

const pollInterval = setInterval(() => {
  pollOnce().catch((error) => {
    console.error("Polling cycle failed", error);
  });
}, config.pollIntervalMs);

pollOnce().catch((error) => {
  console.error("Initial polling cycle failed", error);
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down`);
  clearInterval(pollInterval);

  try {
    await bot.stop();
  } catch (error) {
    console.error("Bot shutdown failed", error);
  }

  try {
    await closeDb(db);
  } catch (error) {
    console.error("Database shutdown failed", error);
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

bot.start({
  onStart: () => {
    console.log("TRON USDT monitoring bot started");
  }
}).catch((error) => {
  console.error("Telegram bot failed", error);
  void shutdown("SIGTERM").then(() => {
    process.exitCode = 1;
  });
});
