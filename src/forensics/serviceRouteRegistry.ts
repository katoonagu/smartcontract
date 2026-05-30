export type ServiceRouteCategory =
  | "cross_chain_bridge"
  | "bridge_aggregator"
  | "dex_router_or_swap_aggregator"
  | "stablecoin_or_wrapped_asset_protocol"
  | "gasless_or_smart_account_service"
  | "unknown_service_route";

export type ServiceRouteRegistryEntry = {
  category: ServiceRouteCategory;
  canonicalName: string;
  aliases: string[];
  keywords: string[];
  policyRiskFloor: number;
  policyRiskCeiling: number;
};

const SERVICE_ROUTE_POLICY_BOUNDS: Record<ServiceRouteCategory, Pick<ServiceRouteRegistryEntry, "policyRiskFloor" | "policyRiskCeiling">> = {
  cross_chain_bridge: { policyRiskFloor: 65, policyRiskCeiling: 75 },
  bridge_aggregator: { policyRiskFloor: 60, policyRiskCeiling: 75 },
  dex_router_or_swap_aggregator: { policyRiskFloor: 55, policyRiskCeiling: 70 },
  stablecoin_or_wrapped_asset_protocol: { policyRiskFloor: 45, policyRiskCeiling: 70 },
  gasless_or_smart_account_service: { policyRiskFloor: 25, policyRiskCeiling: 55 },
  unknown_service_route: { policyRiskFloor: 15, policyRiskCeiling: 60 }
};

type ServiceRouteRegistryDefinition = Omit<ServiceRouteRegistryEntry, "policyRiskFloor" | "policyRiskCeiling"> &
  Partial<Pick<ServiceRouteRegistryEntry, "policyRiskFloor" | "policyRiskCeiling">>;

const SERVICE_ROUTE_REGISTRY_DEFINITIONS: ServiceRouteRegistryDefinition[] = [
  {
    category: "cross_chain_bridge",
    canonicalName: "LayerZero/OFT",
    aliases: ["layerzero", "layer zero", "oft", "usdtoft", "usdt oft"],
    keywords: ["omnichain fungible token", "endpointv2", "endpoint", "executor", "sendpacket", "lzreceive"],
    policyRiskFloor: 0,
    policyRiskCeiling: 65
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Wormhole",
    aliases: ["wormhole"],
    keywords: ["wormhole bridge", "token bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Axelar",
    aliases: ["axelar"],
    keywords: ["axelarnetwork", "gateway", "gas service"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Chainlink CCIP",
    aliases: ["chainlink ccip", "ccip"],
    keywords: ["cross-chain interoperability protocol", "ccip router"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Celer/cBridge",
    aliases: ["celer", "cbridge", "celer cbridge"],
    keywords: ["celer bridge", "cbridge message bus"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Stargate",
    aliases: ["stargate"],
    keywords: ["stargate router", "stargate finance"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "deBridge",
    aliases: ["debridge", "de bridge"],
    keywords: ["debridgegate", "debridge gate"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Synapse",
    aliases: ["synapse"],
    keywords: ["synapse bridge", "synapse protocol"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Allbridge",
    aliases: ["allbridge"],
    keywords: ["allbridge core", "allbridge lp"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Across",
    aliases: ["across"],
    keywords: ["across protocol", "across bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Hop",
    aliases: ["hop"],
    keywords: ["hop protocol", "hop bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Connext/Everclear",
    aliases: ["connext", "everclear"],
    keywords: ["connext bridge", "everclear protocol"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Mayan",
    aliases: ["mayan"],
    keywords: ["mayan finance", "mayan swap"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Symbiosis",
    aliases: ["symbiosis"],
    keywords: ["symbiosis finance", "symbiosis bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Meson",
    aliases: ["meson"],
    keywords: ["meson finance", "meson bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "rhino.fi",
    aliases: ["rhino.fi", "rhinofi"],
    keywords: ["rhino bridge", "rhino fi"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Relay",
    aliases: ["relay"],
    keywords: ["relay bridge", "relay.link", "relay link"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "IBC",
    aliases: ["ibc"],
    keywords: ["inter-blockchain communication", "inter blockchain communication"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Hyperlane",
    aliases: ["hyperlane"],
    keywords: ["hyperlane mailbox", "hyperlane bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Router Protocol",
    aliases: ["router protocol"],
    keywords: ["routerprotocol", "router chain bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "BTTC",
    aliases: ["bttc", "bittorrent chain"],
    keywords: ["bttc bridge", "bittorrent bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Multichain",
    aliases: ["multichain", "anyswap"],
    keywords: ["multichain bridge", "anyswap router"],
    policyRiskFloor: 0,
    policyRiskCeiling: 75
  },
  {
    category: "bridge_aggregator",
    canonicalName: "LI.FI/Jumper",
    aliases: ["li.fi", "lifi", "jumper"],
    keywords: ["li fi", "jumper exchange", "lifi diamond"],
    policyRiskFloor: 0,
    policyRiskCeiling: 75
  },
  {
    category: "bridge_aggregator",
    canonicalName: "Socket/Bungee",
    aliases: ["socket", "bungee"],
    keywords: ["socket bridge", "bungee exchange"],
    policyRiskFloor: 0,
    policyRiskCeiling: 75
  },
  {
    category: "bridge_aggregator",
    canonicalName: "Rango",
    aliases: ["rango"],
    keywords: ["rango exchange", "rango bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 75
  },
  {
    category: "bridge_aggregator",
    canonicalName: "Squid",
    aliases: ["squid"],
    keywords: ["squid router", "squid bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 75
  },
  {
    category: "bridge_aggregator",
    canonicalName: "Rubic",
    aliases: ["rubic"],
    keywords: ["rubic exchange", "rubic bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 75
  },
  {
    category: "bridge_aggregator",
    canonicalName: "OKX DEX Bridge",
    aliases: ["okx dex bridge"],
    keywords: ["okx bridge aggregator", "okx dex aggregator bridge"],
    policyRiskFloor: 0,
    policyRiskCeiling: 75
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "Uniswap",
    aliases: ["uniswap", "uni v3", "univ3"],
    keywords: ["uniswap router", "uniswap universal router", "uniswap v3"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "PancakeSwap",
    aliases: ["pancakeswap", "pancake swap"],
    keywords: ["pancakeswap router", "pancake router"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "Curve",
    aliases: ["curve"],
    keywords: ["curve finance", "curve pool", "curve router"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "Balancer",
    aliases: ["balancer"],
    keywords: ["balancer vault", "balancer pool"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "Sushi",
    aliases: ["sushi", "sushiswap", "sushi swap"],
    keywords: ["sushiswap router", "sushi router"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "1inch",
    aliases: ["1inch", "oneinch"],
    keywords: ["1inch router", "aggregation router"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "0x",
    aliases: ["0x", "zeroex"],
    keywords: ["0x exchange proxy", "zeroex exchange proxy"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "ParaSwap",
    aliases: ["paraswap", "para swap"],
    keywords: ["paraswap augustus", "augustus router"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "OpenOcean",
    aliases: ["openocean", "open ocean"],
    keywords: ["openocean exchange", "openocean router"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "KyberSwap",
    aliases: ["kyberswap", "kyber swap"],
    keywords: ["kyberswap router", "kyber network"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "Odos",
    aliases: ["odos"],
    keywords: ["odos router", "odos swap"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "CowSwap",
    aliases: ["cowswap", "cow swap", "cow protocol"],
    keywords: ["cow settlement", "cowswap settlement"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "Jupiter",
    aliases: ["jupiter"],
    keywords: ["jupiter aggregator", "jupiter swap"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "SunSwap",
    aliases: ["sunswap", "sun swap"],
    keywords: ["sunswap router", "sun io swap"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "JustMoney",
    aliases: ["justmoney", "just money"],
    keywords: ["justmoney exchange", "justmoney swap"],
    policyRiskFloor: 0,
    policyRiskCeiling: 70
  },
  {
    category: "stablecoin_or_wrapped_asset_protocol",
    canonicalName: "Circle CCTP",
    aliases: ["circle cctp", "cctp"],
    keywords: ["cross-chain transfer protocol", "circle token messenger", "token messenger"],
    policyRiskFloor: 0,
    policyRiskCeiling: 65
  },
  {
    category: "stablecoin_or_wrapped_asset_protocol",
    canonicalName: "USDT0",
    aliases: ["usdt0", "usdt zero"],
    keywords: ["usdt0 oft", "usdt0 token"],
    policyRiskFloor: 0,
    policyRiskCeiling: 65
  },
  {
    category: "stablecoin_or_wrapped_asset_protocol",
    canonicalName: "USDD PSM/GemJoin",
    aliases: ["usdd", "psm", "gemjoin", "gem join"],
    keywords: ["peg stability module", "stablecoin module", "stablecoin protocol"],
    policyRiskFloor: 0,
    policyRiskCeiling: 65
  },
  {
    category: "gasless_or_smart_account_service",
    canonicalName: "GasFree",
    aliases: ["gasfree", "gas free"],
    keywords: ["gasfree account", "gasfree endpoint"],
    policyRiskFloor: 0,
    policyRiskCeiling: 75
  },
  {
    category: "gasless_or_smart_account_service",
    canonicalName: "Account Abstraction/Paymaster",
    aliases: ["paymaster", "account abstraction", "permit", "permit2", "relayer"],
    keywords: ["smart account", "erc-4337", "erc4337", "permit transfer", "permittransfer"],
    policyRiskFloor: 0,
    policyRiskCeiling: 75
  }
];

export function serviceRoutePolicyBounds(category: ServiceRouteCategory): Pick<ServiceRouteRegistryEntry, "policyRiskFloor" | "policyRiskCeiling"> {
  return SERVICE_ROUTE_POLICY_BOUNDS[category];
}

export const SERVICE_ROUTE_REGISTRY: ServiceRouteRegistryEntry[] = SERVICE_ROUTE_REGISTRY_DEFINITIONS.map((entry) => ({
  ...entry,
  ...serviceRoutePolicyBounds(entry.category)
}));

function normalized(text: string): string {
  return text.toLowerCase();
}

function containsTerm(text: string, term: string): boolean {
  return text.includes(normalized(term));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAlias(text: string, alias: string): boolean {
  const normalizedAlias = normalized(alias);
  const aliasPattern = escapeRegExp(normalizedAlias).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${aliasPattern}($|[^a-z0-9])`).test(text);
}

export function matchServiceRouteRegistry(text: string): ServiceRouteRegistryEntry | null {
  const haystack = normalized(text);
  if (!haystack) return null;

  const aliasMatch = matchServiceRouteRegistryPhrase(text);
  if (aliasMatch) return aliasMatch;

  let best: { entry: ServiceRouteRegistryEntry; keywordLength: number } | null = null;
  for (const entry of SERVICE_ROUTE_REGISTRY) {
    for (const keyword of entry.keywords) {
      if (!containsTerm(haystack, keyword)) continue;
      if (!best || keyword.length > best.keywordLength) {
        best = { entry, keywordLength: keyword.length };
      }
    }
  }

  return best?.entry ?? null;
}

export function matchServiceRouteRegistryPhrase(text: string): ServiceRouteRegistryEntry | null {
  const haystack = normalized(text);
  if (!haystack) return null;

  for (const entry of SERVICE_ROUTE_REGISTRY) {
    if (entry.aliases.some((alias) => containsAlias(haystack, alias))) return entry;
  }

  return null;
}
