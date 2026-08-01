import { describe, expect, it } from "vitest";
import {
  SANCTIONED_CRYPTO_SERVICES,
  resolveSanctionedCryptoService,
  sanctionedCryptoServiceStateAt
} from "../../src/forensics/sanctionedServiceRegistry";

const htx = SANCTIONED_CRYPTO_SERVICES.find((service) => service.key === "htx_huobi")!;

describe("sanctioned service registry", () => {
  it("evaluates the exact designation boundary and fails closed on unknown time", () => {
    expect(sanctionedCryptoServiceStateAt(htx, "2026-05-25T23:59:59.999Z")).toBe("inactive");
    expect(sanctionedCryptoServiceStateAt(htx, htx.designatedAt)).toBe("active");
    for (const value of [null, undefined, "not-a-date", new Date(Number.NaN)]) {
      expect(sanctionedCryptoServiceStateAt(htx, value)).toBe("unknown");
    }
    expect(sanctionedCryptoServiceStateAt({ ...htx, designatedAt: "invalid" }, htx.designatedAt)).toBe("unknown");
  });

  it("requires every nonempty authority field to identify one consistent service", () => {
    expect(resolveSanctionedCryptoService(["htx_huobi", "HTX/Huobi", "HTX source"])).toBe(htx);
    expect(resolveSanctionedCryptoService(["htx_huobi", "Garantex"])).toBeNull();
    expect(resolveSanctionedCryptoService(["garantex", "HTX in reason"])).toBeNull();
    expect(resolveSanctionedCryptoService([null, undefined, ""])).toBeNull();
  });

  it("does not depend on registry order", () => {
    expect(resolveSanctionedCryptoService(
      ["htx_huobi", "HTX/Huobi"],
      [...SANCTIONED_CRYPTO_SERVICES].reverse()
    )?.key).toBe("htx_huobi");
  });
});
