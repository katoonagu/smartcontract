import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import { extractServiceRouteEvidence } from "../../src/forensics/serviceRouteEvidence";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";

const gasFreeController = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
const gasFreeAccount = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
const gasFreeUser = "TW2Py9fWGc1HVXhejufX1stuwQ9N42Y8RE";
const gasFreeReceiver = "TMwjbNHpsVSjn93vtWtLnThHwhAJAnrWNq";
const gasFreeTlnt = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";

const gasFreeUintWord = (value: bigint): string => value.toString(16).padStart(64, "0");
const gasFreeAddressWord = (address: string): string => TronWeb.address.toHex(address).slice(2).padStart(64, "0");

function gasFreeTransaction() {
  const signature = "11".repeat(65);
  const data = [
    "6f21b898",
    gasFreeAddressWord(TRON_USDT_CONTRACT_ADDRESS),
    gasFreeAddressWord(gasFreeUser),
    gasFreeAddressWord(gasFreeReceiver),
    gasFreeUintWord(97_000_000n),
    gasFreeUintWord(3_000_000n),
    gasFreeUintWord(1_800_000_000n),
    gasFreeUintWord(1n),
    gasFreeUintWord(9n),
    gasFreeUintWord(0x120n),
    gasFreeUintWord(65n),
    signature.padEnd(192, "0")
  ].join("");
  const row = (toAddress: string, amountRaw: string) => ({
    from_address: gasFreeAccount,
    to_address: toAddress,
    amount_str: amountRaw,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenType: "trc20" }
  });
  return {
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    contractData: { contract_address: gasFreeController, data },
    trc20TransferInfo: [row(gasFreeReceiver, "97000000"), row(gasFreeTlnt, "3000000")]
  };
}

describe("service route evidence extraction", () => {
  it("detects LayerZero/OFT delivery without confirmed approval-drain proof", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "TEndpoint222222222222222222222222222",
            name: "LayerZero EndpointV2",
            tag: "Endpoint",
            isContract: true
          },
          {
            address: "TExecutor333333333333333333333333333",
            name: "LayerZero Executor",
            tag: "Executor",
            isContract: true
          },
          {
            address: "TUsdtOft4444444444444444444444444444",
            name: "UsdtOFT Omnichain Fungible Token",
            tag: "OFT",
            isContract: true
          }
        ],
        contract_map: {
          TUsdtOft4444444444444444444444444444: true
        },
        trigger_info: {
          methodName: "lzReceive(uint32,bytes32,uint64,bytes)"
        },
        trc20TransferInfo: [
          {
            from_address: "TUsdtOft4444444444444444444444444444",
            to_address: "TSubject1111111111111111111111111111",
            symbol: "USDT",
            amount_str: "1000000"
          }
        ]
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result).toMatchObject({
      kind: "layerzero_oft_delivery",
      category: "cross_chain_bridge",
      identity: "LayerZero/OFT",
      confidence: "high",
      drainProof: "not_proven",
      policyRiskFloor: 65,
      policyRiskCeiling: 75
    });
    expect(result.guardCodes).toEqual(expect.arrayContaining([
      "usdt_from_address_is_contract",
      "layerzero_endpoint_present",
      "oft_contract_present",
      "no_confirmed_approval_drain"
    ]));
  });

  it("detects a DEX/router route as a boundary without proven drain proof", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "TSunSwap555555555555555555555555555",
            name: "SunSwap Router",
            tag: "DEX",
            isContract: true
          }
        ],
        trc20TransferInfo: [
          {
            from_address: "TSunSwap555555555555555555555555555",
            to_address: "TSubject1111111111111111111111111111",
            symbol: "USDT"
          }
        ],
        trigger_info: {
          methodName: "swapExactTokensForTokens"
        }
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result).toMatchObject({
      kind: "dex_router_boundary",
      category: "dex_router_or_swap_aggregator",
      drainProof: "not_proven",
      policyRiskFloor: 55,
      policyRiskCeiling: 70
    });
    expect(result.guardCodes).toContain("service_route_boundary_present");
  });

  it("detects unknown contract funding subject with bounded risk ceiling", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "TUnknown666666666666666666666666666",
            name: "CreatedByContract",
            tag: null,
            isContract: true
          }
        ],
        trc20TransferInfo: [
          {
            from_address: "TUnknown666666666666666666666666666",
            to_address: "TSubject1111111111111111111111111111",
            symbol: "USDT"
          }
        ]
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result).toMatchObject({
      kind: "unknown_service_route",
      category: "unknown_service_route",
      drainProof: "not_proven",
      policyRiskFloor: 15,
      policyRiskCeiling: 60
    });
    expect(result.policyRiskCeiling).toBeLessThan(95);
  });

  it("carries bridge aggregator policy bounds into evidence", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "TLifi111111111111111111111111111111",
            name: "LI.FI Jumper",
            tag: "Bridge Aggregator",
            isContract: true
          }
        ]
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result).toMatchObject({
      kind: "known_service_route",
      category: "bridge_aggregator",
      identity: "LI.FI/Jumper",
      policyRiskFloor: 60,
      policyRiskCeiling: 75
    });
  });

  it("carries stablecoin protocol policy bounds into evidence", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "TCctp111111111111111111111111111111",
            name: "Circle CCTP Token Messenger",
            tag: "Stablecoin Protocol",
            isContract: true
          }
        ]
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result).toMatchObject({
      kind: "known_service_route",
      category: "stablecoin_or_wrapped_asset_protocol",
      identity: "Circle CCTP",
      policyRiskFloor: 45,
      policyRiskCeiling: 70
    });
  });

  it("carries gasless service policy bounds into evidence", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "TGasFree111111111111111111111111111",
            name: "GasFree Account",
            tag: "Paymaster",
            isContract: true
          }
        ]
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result).toMatchObject({
      kind: "known_service_route",
      category: "gasless_or_smart_account_service",
      identity: "GasFree",
      confidence: "medium",
      policyRiskFloor: 25,
      policyRiskCeiling: 55
    });
    expect(result.guardCodes).not.toContain("gasfree_controller_exact");
  });

  it.each([
    [gasFreeReceiver, "gasfree_principal"],
    [gasFreeTlnt, "gasfree_service_fee"]
  ])("emits exact GasFree controller and %s role evidence", (subjectAddress, roleCode) => {
    const result = extractServiceRouteEvidence({
      subjectAddress,
      transactionInfo: gasFreeTransaction(),
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result).toMatchObject({
      kind: "known_service_route",
      confidence: "high",
      category: "gasless_or_smart_account_service",
      identity: "GasFree",
      policyRiskFloor: 25,
      policyRiskCeiling: 55
    });
    expect(result.guardCodes).toEqual(expect.arrayContaining([
      "gasfree_controller_exact",
      roleCode,
      "no_confirmed_approval_drain"
    ]));
  });

  it("does not treat a Binance Gateway CEX label as service-route evidence without bridge context", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "TBinanceGateway111111111111111111111",
            name: "Binance Gateway",
            tag: "Binance",
            isContract: true
          }
        ],
        trigger_info: {
          methodName: "transfer(address,uint256)"
        }
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result.kind).toBe("none");
    expect(result.category).toBeNull();
    expect(result.signals).not.toEqual(expect.arrayContaining([
      "service_route:cross_chain_bridge",
      "service_route_identity:Axelar"
    ]));
  });

  it("does not treat an OKX Endpoint CEX label as LayerZero or Axelar route evidence without a stronger phrase", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "TOKXEndpoint111111111111111111111111",
            name: "OKX Endpoint",
            tag: "OKX",
            isContract: true
          }
        ]
      },
      contractProfile: {
        name: "OKX Endpoint"
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result.kind).toBe("none");
    expect(result.category).toBeNull();
    expect(result.signals).not.toEqual(expect.arrayContaining([
      "service_route:cross_chain_bridge",
      "service_route_identity:LayerZero/OFT",
      "service_route_identity:Axelar"
    ]));
  });

  it("does not treat an HTX Endpoint CEX label as LayerZero route evidence without a stronger phrase", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "THTXEndpoint111111111111111111111111",
            name: "HTX Endpoint",
            tag: "HTX",
            isContract: true
          }
        ]
      },
      contractProfile: {
        name: "HTX Endpoint"
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result.kind).toBe("none");
    expect(result.category).toBeNull();
    expect(result.signals).not.toEqual(expect.arrayContaining([
      "service_route:cross_chain_bridge",
      "service_route_identity:LayerZero/OFT"
    ]));
  });

  it("does not treat a Huobi Gateway CEX label as Axelar route evidence without a stronger phrase", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "THuobiGateway111111111111111111111",
            name: "Huobi Gateway",
            tag: "Huobi",
            isContract: true
          }
        ],
        trigger_info: {
          methodName: "transfer(address,uint256)"
        }
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result.kind).toBe("none");
    expect(result.category).toBeNull();
    expect(result.signals).not.toEqual(expect.arrayContaining([
      "service_route:cross_chain_bridge",
      "service_route_identity:Axelar"
    ]));
  });

  it("does not treat contract_map false as a contract sender", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contract_map: {
          TUser777777777777777777777777777777: false
        },
        trc20TransferInfo: [
          {
            from_address: "TUser777777777777777777777777777777",
            to_address: "TSubject1111111111111111111111111111",
            symbol: "USDT"
          }
        ]
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result.kind).toBe("none");
    expect(result.contracts).toContainEqual(expect.objectContaining({
      address: "TUser777777777777777777777777777777",
      isContract: false
    }));
  });

  it("detects LayerZero/OFT delivery from tokenTransferInfo camelCase fields", () => {
    const result = extractServiceRouteEvidence({
      subjectAddress: "TSubject1111111111111111111111111111",
      transactionInfo: {
        contractInfo: [
          {
            address: "TEndpoint222222222222222222222222222",
            name: "LayerZero EndpointV2",
            tag: "Endpoint",
            isContract: true
          },
          {
            address: "TExecutor333333333333333333333333333",
            name: "LayerZero Executor",
            tag: "Executor",
            isContract: true
          },
          {
            address: "TUsdtOft4444444444444444444444444444",
            name: "UsdtOFT Omnichain Fungible Token",
            tag: "OFT",
            isContract: true
          }
        ],
        tokenTransferInfo: [
          {
            fromAddress: "TUsdtOft4444444444444444444444444444",
            toAddress: "TSubject1111111111111111111111111111",
            tokenInfo: {
              tokenAbbr: "USDT",
              tokenId: "Tether USD"
            },
            amountStr: "1000000"
          }
        ]
      },
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(result).toMatchObject({
      kind: "layerzero_oft_delivery",
      category: "cross_chain_bridge",
      identity: "LayerZero/OFT",
      policyRiskFloor: 65,
      policyRiskCeiling: 75
    });
  });
});
