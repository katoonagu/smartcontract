import { describe, expect, it } from "vitest";
import { SERVICE_ROUTE_REGISTRY, matchServiceRouteRegistry } from "../../src/forensics/serviceRouteRegistry";

describe("service route registry", () => {
  it("matches LayerZero/OFT aliases and keywords", () => {
    expect(matchServiceRouteRegistry("LayerZero EndpointV2 executor UsdtOFT")?.canonicalName).toBe("LayerZero/OFT");
    expect(matchServiceRouteRegistry("omnichain fungible token lzReceive")?.canonicalName).toBe("LayerZero/OFT");
  });

  it("assigns policy bounds to LayerZero/OFT and common bridges", () => {
    expect(matchServiceRouteRegistry("LayerZero EndpointV2 executor UsdtOFT")).toMatchObject({
      category: "cross_chain_bridge",
      policyRiskFloor: 65,
      policyRiskCeiling: 75
    });
    expect(matchServiceRouteRegistry("Wormhole Token Bridge")).toMatchObject({
      category: "cross_chain_bridge",
      policyRiskFloor: 65,
      policyRiskCeiling: 75
    });
  });

  it("matches common bridges", () => {
    expect(matchServiceRouteRegistry("Wormhole Token Bridge")?.canonicalName).toBe("Wormhole");
    expect(matchServiceRouteRegistry("Axelar Gateway")?.canonicalName).toBe("Axelar");
  });

  it("matches bridge aggregators", () => {
    expect(matchServiceRouteRegistry("LI.FI Jumper route")?.canonicalName).toBe("LI.FI/Jumper");
  });

  it("assigns policy bounds to bridge aggregators", () => {
    expect(matchServiceRouteRegistry("LI.FI Jumper route")).toMatchObject({
      category: "bridge_aggregator",
      policyRiskFloor: 60,
      policyRiskCeiling: 75
    });
  });

  it("matches DEX/router aggregators", () => {
    expect(matchServiceRouteRegistry("Uniswap Universal Router")?.canonicalName).toBe("Uniswap");
    expect(matchServiceRouteRegistry("SunSwap Router")?.canonicalName).toBe("SunSwap");
  });

  it("assigns policy bounds to DEX/router aggregators", () => {
    expect(matchServiceRouteRegistry("Uniswap Universal Router")).toMatchObject({
      category: "dex_router_or_swap_aggregator",
      policyRiskFloor: 55,
      policyRiskCeiling: 70
    });
  });

  it("matches stablecoin and wrapped asset protocols", () => {
    expect(matchServiceRouteRegistry("Circle CCTP Token Messenger")?.canonicalName).toBe("Circle CCTP");
  });

  it("assigns policy bounds to stablecoin and wrapped asset protocols", () => {
    expect(matchServiceRouteRegistry("Circle CCTP Token Messenger")).toMatchObject({
      category: "stablecoin_or_wrapped_asset_protocol",
      policyRiskFloor: 45,
      policyRiskCeiling: 70
    });
  });

  it("matches gasless smart account services", () => {
    expect(matchServiceRouteRegistry("GasFree Account paymaster")?.canonicalName).toBe("GasFree");
  });

  it("assigns policy bounds to gasless smart account services", () => {
    expect(matchServiceRouteRegistry("GasFree Account paymaster")).toMatchObject({
      category: "gasless_or_smart_account_service",
      policyRiskFloor: 25,
      policyRiskCeiling: 55
    });
  });

  it("keeps all known service route policy floors nonzero", () => {
    expect(SERVICE_ROUTE_REGISTRY.every((entry) => entry.policyRiskFloor > 0)).toBe(true);
  });

  it("does not match short aliases inside longer service names", () => {
    const result = matchServiceRouteRegistry("relayer");

    expect(result).toMatchObject({
      category: "gasless_or_smart_account_service",
      canonicalName: "Account Abstraction/Paymaster"
    });
  });
});
