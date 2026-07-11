import { describe, expect, it } from "vitest";
import {
  detectVerify20Fingerprint,
  type Verify20FingerprintInput
} from "../../src/forensics/verify20Fingerprint";

const signatures = {
  "5082dd12": "Verify20(address,address,address,uint256)",
  fc61dd23: "Verify10(address,uint256)",
  ea4418d9: "withdrawAllTrxTo(address)",
  f2fde38b: "transferOwnership(address)"
} as const;

const methodNames = {
  "5082dd12": "Verify20",
  fc61dd23: "Verify10",
  ea4418d9: "withdrawAllTrxTo",
  f2fde38b: "transferOwnership"
} as const;

function exactProfile(): Verify20FingerprintInput {
  return {
    methodMap: { ...signatures },
    topMethods: []
  };
}

describe("Verify20 fingerprint", () => {
  it("matches the complete selector/signature family in canonical order across normalized profile sources", () => {
    const result = detectVerify20Fingerprint({
      methodMap: {
        "0xEA4418D9": "WITHDRAWALLTRXTO(ADDRESS)",
        fc61dd23: signatures.fc61dd23,
        deadbeef: "ordinaryExtra(uint256)"
      },
      topMethods: [
        {
          methodId: "0xF2FDE38B",
          signature: signatures.f2fde38b,
          count: 2,
          ratio: 0.2
        },
        {
          methodId: "0X5082DD12",
          signature: null,
          method: signatures["5082dd12"],
          count: 8,
          ratio: 0.8
        },
        {
          methodId: "5082dd12",
          signature: signatures["5082dd12"],
          count: 1,
          ratio: 0.1
        }
      ]
    });

    expect(result).toEqual({
      matched: true,
      selectors: ["5082dd12", "fc61dd23", "ea4418d9", "f2fde38b"],
      blockedByTrustedService: false,
      missingSelectors: [],
      mismatchedSelectors: []
    });
  });

  it.each(Object.keys(signatures))("does not match when %s is missing", (missingSelector) => {
    const methodMap = Object.fromEntries(
      Object.entries(signatures).filter(([selector]) => selector !== missingSelector)
    );

    const result = detectVerify20Fingerprint({ methodMap, topMethods: [] });

    expect(result.matched).toBe(false);
    expect(result.missingSelectors).toEqual([missingSelector]);
  });

  it("does not match a single selector or unrelated extras", () => {
    expect(detectVerify20Fingerprint({
      methodMap: {
        "5082dd12": signatures["5082dd12"],
        a9059cbb: "transfer(address,uint256)",
        "095ea7b3": "approve(address,uint256)"
      },
      topMethods: []
    }).matched).toBe(false);

    expect(detectVerify20Fingerprint({
      ...exactProfile(),
      methodMap: {
        ...signatures,
        a9059cbb: "transfer(address,uint256)",
        "095ea7b3": "approve(address,uint256)"
      }
    }).matched).toBe(true);
  });

  it("rejects malformed selectors and selector/signature collisions", () => {
    const malformed = detectVerify20Fingerprint({
      methodMap: {
        fc61dd23: signatures.fc61dd23,
        ea4418d9: signatures.ea4418d9,
        f2fde38b: signatures.f2fde38b,
        "5082dd1": signatures["5082dd12"],
        "0x5082dd1z": signatures["5082dd12"]
      },
      topMethods: []
    });
    expect(malformed).toMatchObject({
      matched: false,
      missingSelectors: ["5082dd12"]
    });

    const collision = detectVerify20Fingerprint({
      ...exactProfile(),
      methodMap: {
        ...signatures,
        "5082dd12": "approve(address,uint256)"
      },
      topMethods: [{
        methodId: "fc61dd23",
        signature: "Verify10(address,address)",
        count: 1,
        ratio: 1
      }]
    });

    expect(collision).toMatchObject({
      matched: false,
      missingSelectors: ["5082dd12"],
      mismatchedSelectors: ["5082dd12", "fc61dd23"]
    });
  });

  it("fails closed when an explicit trusted service label is supplied", () => {
    expect(detectVerify20Fingerprint({
      ...exactProfile(),
      serviceLabel: "  Trusted Service  "
    })).toMatchObject({
      matched: false,
      blockedByTrustedService: true,
      selectors: ["5082dd12", "fc61dd23", "ea4418d9", "f2fde38b"]
    });
  });

  it("does not infer the fingerprint from contract names or AI text", () => {
    const narrativeOnly = {
      methodMap: {},
      topMethods: [],
      name: "Verify20 transferOwnership withdrawAllTrxTo",
      aiVerdict: "Exact Verify20 drainer fingerprint"
    };

    expect(detectVerify20Fingerprint(narrativeOnly)).toMatchObject({
      matched: false,
      selectors: [],
      blockedByTrustedService: false
    });
  });

  it.each(["selector-only", "unknown", "name-only"] as const)(
    "requires a full signature for every selector when top-method metadata is %s",
    (metadata) => {
      const topMethods = Object.keys(signatures).map((methodId) => ({
        methodId,
        signature: null,
        method: metadata === "selector-only"
          ? undefined
          : metadata === "unknown"
            ? "unknown"
            : methodNames[methodId as keyof typeof methodNames],
        count: 1,
        ratio: 0.25
      }));

      expect(detectVerify20Fingerprint({ methodMap: {}, topMethods })).toEqual({
        matched: false,
        selectors: [],
        blockedByTrustedService: false,
        missingSelectors: ["5082dd12", "fc61dd23", "ea4418d9", "f2fde38b"],
        mismatchedSelectors: []
      });
    }
  );

  it("uses full-signature content regardless of which profile field supplied it", () => {
    const result = detectVerify20Fingerprint({
      methodMap: { ...methodNames },
      topMethods: Object.entries(signatures).map(([methodId, signature]) => ({
        methodId,
        signature: methodNames[methodId as keyof typeof methodNames],
        method: signature,
        count: 1,
        ratio: 0.25
      }))
    });

    expect(result).toEqual({
      matched: true,
      selectors: ["5082dd12", "fc61dd23", "ea4418d9", "f2fde38b"],
      blockedByTrustedService: false,
      missingSelectors: [],
      mismatchedSelectors: []
    });
  });

  it("keeps plain provider names neutral beside exact signatures but blocks conflicting full signatures", () => {
    const topMethods: NonNullable<Verify20FingerprintInput["topMethods"]> = Object.entries(methodNames).map(([methodId, method]) => ({
      methodId,
      signature: null,
      method,
      count: 1,
      ratio: 0.25
    }));
    const withPlainNames = detectVerify20Fingerprint({ methodMap: { ...signatures }, topMethods });

    expect(withPlainNames.matched).toBe(true);

    topMethods[0] = {
      ...topMethods[0],
      method: "Verify20(address,uint256)"
    };
    expect(detectVerify20Fingerprint({ methodMap: { ...signatures }, topMethods })).toMatchObject({
      matched: false,
      missingSelectors: [],
      mismatchedSelectors: ["5082dd12"]
    });
  });
});
