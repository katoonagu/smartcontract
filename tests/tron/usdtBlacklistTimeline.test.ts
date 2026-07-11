import { TronWeb } from "tronweb";
import { describe, expect, it } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import { parseBlacklistRows, verifyBlacklistEvent } from "../../src/tron/usdtBlacklistTimeline";

const ADDRESS = "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm";
const WRONG_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const TX = "a".repeat(64);
const ADDED_TOPIC = TronWeb.sha3("AddedBlackList(address)");
const REMOVED_TOPIC = TronWeb.sha3("RemovedBlackList(address)");

function hexAddress(address: string): string {
  return `0x${TronWeb.address.toHex(address).slice(2).toLowerCase()}`;
}

function addressTopic(address: string): string {
  return `0x${TronWeb.address.toHex(address).slice(2).padStart(64, "0").toLowerCase()}`;
}

function blacklistRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    blackAddress: hexAddress(ADDRESS),
    tokenName: "USDT",
    num: "1",
    time: 1_783_763_343,
    transHash: TX,
    contractAddress: TRON_USDT_CONTRACT_ADDRESS,
    ...overrides
  };
}

function contractEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transaction_id: TX,
    block_number: 73_456_789,
    block_timestamp: 1_783_763_343_000,
    event_index: 2,
    event_name: "AddedBlackList",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    result: { _user: hexAddress(ADDRESS) },
    topics: [ADDED_TOPIC, addressTopic(ADDRESS)],
    confirmed: true,
    contractRet: "SUCCESS",
    ...overrides
  };
}

describe("parseBlacklistRows", () => {
  it("normalizes address-scoped Unix-second rows and removes exact duplicates", () => {
    const row = blacklistRow();

    expect(parseBlacklistRows([row, { ...row }], ADDRESS)).toEqual([
      {
        blackAddress: ADDRESS,
        tokenName: "USDT",
        num: "1",
        time: 1_783_763_343,
        transHash: TX,
        contractAddress: TRON_USDT_CONTRACT_ADDRESS
      }
    ]);
  });

  it("rejects malformed, address-mismatched, wrong-contract, and ambiguous rows", () => {
    expect(() => parseBlacklistRows([blacklistRow({ time: 1_783_763_343_000 })], ADDRESS)).toThrow(/malformed/i);
    expect(() => parseBlacklistRows([blacklistRow({ blackAddress: WRONG_ADDRESS })], ADDRESS)).toThrow(/address mismatch/i);
    expect(() => parseBlacklistRows([blacklistRow({ contractAddress: ADDRESS })], ADDRESS)).toThrow(/contract mismatch/i);
    expect(() => parseBlacklistRows([
      blacklistRow(),
      blacklistRow({ time: 1_783_763_344 })
    ], ADDRESS)).toThrow(/ambiguous duplicate/i);
  });
});

describe("verifyBlacklistEvent", () => {
  it("builds a verified added event from the exact official contract log", () => {
    expect(verifyBlacklistEvent([contractEvent()], ADDRESS)).toEqual({
      eventKind: "added",
      occurredAt: "2026-07-11T09:49:03.000Z",
      txHash: TX,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      blockNumber: 73_456_789,
      logIndex: 2,
      verification: "verified_contract_log"
    });
  });

  it("decodes added and removed kinds and the indexed user from raw topics", () => {
    const topicOnly = (topic: string, txHash: string, timestamp: number, logIndex: number) => {
      const event = contractEvent({
        transaction_id: txHash,
        block_timestamp: timestamp,
        event_index: logIndex,
        result: {},
        topics: [topic, addressTopic(ADDRESS)]
      });
      delete event.event_name;
      return event;
    };
    const events = [
      verifyBlacklistEvent([topicOnly(ADDED_TOPIC, "b".repeat(64), 1_700_000_000_000, 0)], ADDRESS),
      verifyBlacklistEvent([topicOnly(REMOVED_TOPIC, "c".repeat(64), 1_710_000_000_000, 1)], ADDRESS),
      verifyBlacklistEvent([topicOnly(ADDED_TOPIC, "d".repeat(64), 1_720_000_000_000, 2)], ADDRESS)
    ];

    expect(events.map((event) => event?.eventKind)).toEqual(["added", "removed", "added"]);
  });

  it("rejects a different contract, user, event topic, or ambiguous matching logs", () => {
    expect(verifyBlacklistEvent([contractEvent({ contract_address: ADDRESS })], ADDRESS)).toBeNull();
    expect(verifyBlacklistEvent([contractEvent({
      result: { _user: hexAddress(WRONG_ADDRESS) },
      topics: [ADDED_TOPIC, addressTopic(WRONG_ADDRESS)]
    })], ADDRESS)).toBeNull();
    expect(verifyBlacklistEvent([contractEvent({ topics: [TronWeb.sha3("Transfer(address,address,uint256)"), addressTopic(ADDRESS)] })], ADDRESS)).toBeNull();
    expect(verifyBlacklistEvent([contractEvent(), contractEvent({ event_index: 3 })], ADDRESS)).toBeNull();
  });

  it("rejects unconfirmed, unsuccessful, malformed, and decoded-user/topic disagreements", () => {
    expect(verifyBlacklistEvent([contractEvent({ confirmed: false })], ADDRESS)).toBeNull();
    expect(verifyBlacklistEvent([contractEvent({ contractRet: "REVERT" })], ADDRESS)).toBeNull();
    expect(verifyBlacklistEvent([contractEvent({ transaction_id: "not-a-hash" })], ADDRESS)).toBeNull();
    expect(verifyBlacklistEvent([contractEvent({
      result: { _user: hexAddress(WRONG_ADDRESS) },
      topics: [ADDED_TOPIC, addressTopic(ADDRESS)]
    })], ADDRESS)).toBeNull();
  });

  const aliasConflicts: Array<[string, (event: Record<string, unknown>) => void]> = [
    ["contract_address/contractAddress", (event) => { event.contractAddress = ADDRESS; }],
    ["contract_address/address", (event) => { event.address = ADDRESS; }],
    ["contractAddress/address", (event) => {
      delete event.contract_address;
      event.contractAddress = TRON_USDT_CONTRACT_ADDRESS;
      event.address = ADDRESS;
    }],
    ["transaction_id/transactionId", (event) => { event.transactionId = "b".repeat(64); }],
    ["transaction_id/transaction", (event) => { event.transaction = "b".repeat(64); }],
    ["transactionId/transaction", (event) => {
      delete event.transaction_id;
      event.transactionId = TX;
      event.transaction = "b".repeat(64);
    }],
    ["block_number/blockNumber", (event) => { event.blockNumber = 73_456_790; }],
    ["event_index/log_index", (event) => { event.log_index = 3; }],
    ["event_index/eventIndex", (event) => { event.eventIndex = 3; }],
    ["event_index/logIndex", (event) => { event.logIndex = 3; }],
    ["log_index/eventIndex", (event) => {
      delete event.event_index;
      event.log_index = 2;
      event.eventIndex = 3;
    }],
    ["log_index/logIndex", (event) => {
      delete event.event_index;
      event.log_index = 2;
      event.logIndex = 3;
    }],
    ["eventIndex/logIndex", (event) => {
      delete event.event_index;
      event.eventIndex = 2;
      event.logIndex = 3;
    }],
    ["block_timestamp/blockTimestamp", (event) => { event.blockTimestamp = 1_783_763_344_000; }],
    ["block_timestamp/blockTimeStamp", (event) => { event.blockTimeStamp = 1_783_763_344_000; }],
    ["blockTimestamp/blockTimeStamp", (event) => {
      delete event.block_timestamp;
      event.blockTimestamp = 1_783_763_343_000;
      event.blockTimeStamp = 1_783_763_344_000;
    }],
    ["contractRet/contract_ret", (event) => { event.contract_ret = "REVERT"; }],
    ["contractRet/receipt.result", (event) => { event.receipt = { result: "REVERT" }; }],
    ["contract_ret/receipt.result", (event) => {
      delete event.contractRet;
      event.contract_ret = "SUCCESS";
      event.receipt = { result: "REVERT" };
    }],
    ["event_name/eventName", (event) => { event.eventName = "RemovedBlackList"; }]
  ];

  it.each(aliasConflicts)("rejects conflicting %s aliases", (_name, mutate) => {
    const event = contractEvent();
    mutate(event);
    expect(verifyBlacklistEvent([event], ADDRESS)).toBeNull();
  });

  const malformedAliases: Array<[string, (event: Record<string, unknown>) => void]> = [
    ["contractAddress", (event) => { event.contractAddress = 42; }],
    ["address", (event) => { event.address = 42; }],
    ["transactionId", (event) => { event.transactionId = 42; }],
    ["transaction", (event) => { event.transaction = 42; }],
    ["blockNumber", (event) => { event.blockNumber = "not-a-block"; }],
    ["log_index", (event) => { event.log_index = "not-an-index"; }],
    ["eventIndex", (event) => { event.eventIndex = "not-an-index"; }],
    ["logIndex", (event) => { event.logIndex = "not-an-index"; }],
    ["blockTimestamp", (event) => { event.blockTimestamp = "not-a-timestamp"; }],
    ["blockTimeStamp", (event) => { event.blockTimeStamp = "not-a-timestamp"; }],
    ["contract_ret", (event) => { event.contract_ret = 42; }],
    ["receipt.result", (event) => { event.receipt = { result: 42 }; }],
    ["eventName", (event) => { event.eventName = 42; }]
  ];

  it.each(malformedAliases)("rejects malformed present %s alias", (_name, mutate) => {
    const event = contractEvent();
    mutate(event);
    expect(verifyBlacklistEvent([event], ADDRESS)).toBeNull();
  });

  it("rejects a valid topic when a present event name is contradictory or unrecognized", () => {
    expect(verifyBlacklistEvent([contractEvent({ event_name: "RemovedBlackList" })], ADDRESS)).toBeNull();
    expect(verifyBlacklistEvent([contractEvent({ event_name: "Transfer" })], ADDRESS)).toBeNull();
  });

  it("rejects an indexed address topic with non-zero ABI padding", () => {
    const nonCanonicalUserTopic = `0x${"1".repeat(24)}${TronWeb.address.toHex(ADDRESS).slice(2).toLowerCase()}`;

    expect(verifyBlacklistEvent([contractEvent({
      result: {},
      topics: [ADDED_TOPIC, nonCanonicalUserTopic]
    })], ADDRESS)).toBeNull();
  });

  it("requires exactly two topics for added and removed blacklist events", () => {
    const extraTopic = `0x${"0".repeat(64)}`;
    expect(verifyBlacklistEvent([contractEvent({
      topics: [ADDED_TOPIC, addressTopic(ADDRESS), extraTopic]
    })], ADDRESS)).toBeNull();
    expect(verifyBlacklistEvent([contractEvent({
      event_name: "RemovedBlackList",
      topics: [REMOVED_TOPIC, addressTopic(ADDRESS), extraTopic]
    })], ADDRESS)).toBeNull();
  });
});
