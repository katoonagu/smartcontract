# TRON/BSC Incident Forensic Notes

Date checked: 2026-05-15

## Executive Summary

The root cause is not a hidden smart contract at `TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj`.

`TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj` is an externally owned TRON account. The victim wallet `TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d` signed an unlimited USDT approval to that account on 2026-05-06. On 2026-05-09, `TMou...` used that allowance to call USDT `transferFrom` twice and moved `321,952.450320 USDT` from the victim to `TPhaahG2WfYR2y7tiexbfc6xSvVpuy7Ep4`.

The victim did not need to sign the later drain transactions. Once approval existed, the spender could pull funds when the balance became large enough.

## Root Cause Evidence

### Unlimited Approval

- Transaction: `aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2`
- Time: 2026-05-06 19:06:15 UTC
- Owner/signer: `TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d`
- Token contract: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (USDT TRC20)
- Method: `approve(address _spender,uint256 _value)`
- Spender: `TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj`
- Amount: `115792089237316195423570985008687907853269984665640564039457584007913129639935` (`2^256 - 1`)
- Tronscan: `https://apilist.tronscanapi.com/api/transaction-info?hash=aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2`

### Drain Transactions

| Time UTC | Tx | Signer / ownerAddress | Method | From | To | Amount |
|---|---|---|---|---|---|---:|
| 2026-05-09 10:13:12 | `a944c454b019c6fdbb686f29609b08fbc378f1dee20ecd772a8417b1f7f6452b` | `TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj` | `transferFrom` | `TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d` | `TPhaahG2WfYR2y7tiexbfc6xSvVpuy7Ep4` | `320,652.450320 USDT` |
| 2026-05-09 10:34:00 | `c581fee9f089c14b58210f3aafdbd96691356e41bc05fa20ee0a94f25d41838e` | `TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj` | `transferFrom` | `TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d` | `TPhaahG2WfYR2y7tiexbfc6xSvVpuy7Ep4` | `1,300.000000 USDT` |

Total drained: `321,952.450320 USDT`.

Sources:

- `https://apilist.tronscanapi.com/api/transaction-info?hash=a944c454b019c6fdbb686f29609b08fbc378f1dee20ecd772a8417b1f7f6452b`
- `https://apilist.tronscanapi.com/api/transaction-info?hash=c581fee9f089c14b58210f3aafdbd96691356e41bc05fa20ee0a94f25d41838e`

## Address Type Checks

TRON:

- `TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj`: `contract_map=false`; account owner/active permission key is itself.
- `TPhaahG2WfYR2y7tiexbfc6xSvVpuy7Ep4`: `contract_map=false`.
- `TXu3sNwjyvNvCWY9kdZGZfCSDV1ikz25A4`: `contract_map=false`.

BSC RPC `eth_getCode(..., latest)` returned `0x` for these addresses:

- `0x3c38a410a09539b9bdeea3e5723dbf68c2d282da`
- `0xF874c3Ed7196B5Dc72B6D83a8d30B2aF290A815F`
- `0xA585014b608785B51745a051DF5BE1BEaaa03CA8`
- `0x282Fb3eE9Cf2021bAB66E301aE7c77185Bb41E3f`
- `0xCC1540D2f1E315F4FAfA8276c05B72c3Ccf86866`
- `0xD2E8643F85941730B917a2B995C77b08B59C277d`
- `0x50Dbd16E14e92985859C5196b1b607eEd52B1dBC`
- `0x392131cA64EF3212520Ba52E5dFe1b92Ac795886`
- `0xb3eE66a3029ba65999b243450ef160838BD648f2`
- `0xeadE9c792279B4b86153529D44f02Ceef97609e6`

Conclusion: these are not deployed contracts on BSC at the checked block state.

## TRON Movement After Drain

`TPhaahG2WfYR2y7tiexbfc6xSvVpuy7Ep4` distributed the drained USDT as follows:

| Time UTC | Tx | To | Amount |
|---|---|---|---:|
| 2026-05-09 16:49:51 | `98077caa9f18fb78092d93d39303013ca8f988cc69398b138991a4f344549d38` | `TWfqJRF7LMmVGCssb6dDyCVtVrKD5yjfzi` | `102.450320 USDT` |
| 2026-05-09 20:33:15 | `89c5d23532095d77d3d7c6fd6c485329d65caef79472f1f23b4ae8bc2445c712` | `TZ35bQLtBKXUvhjFPJeqhrs37FDqqV4REw` | `9,999.000000 USDT` |
| 2026-05-09 21:06:51 | `819c22346b3e01109860991a9c526116b22511f8c5558e24b8f789929b8f37fc` | `TXu3sNwjyvNvCWY9kdZGZfCSDV1ikz25A4` | `999.000000 USDT` |
| 2026-05-09 21:59:18 | `674e7befcb8eee23398cb1c28efa357c0f8857d1243cb200c5934753d60261b7` | `TXu3sNwjyvNvCWY9kdZGZfCSDV1ikz25A4` | `99,999.000000 USDT` |
| 2026-05-09 22:52:27 | `0a3172aa7431b6b61c884fc5d4674226973bcf087e5eb2cc125bbfb1b1e47511` | `TXu3sNwjyvNvCWY9kdZGZfCSDV1ikz25A4` | `111,111.000000 USDT` |
| 2026-05-09 23:00:51 | `347e9d410e49f0fc635b677c464b4860b9849122f6de8ff28accd5ba6422945a` | `TXu3sNwjyvNvCWY9kdZGZfCSDV1ikz25A4` | `99,742.000000 USDT` |

Total:

- To `TXu3...`: `311,851.000000 USDT`
- To `TZ35...`: `9,999.000000 USDT`
- To `TWfq...`: `102.450320 USDT`
- Sum: `321,952.450320 USDT`

## Allbridge Leg

`TXu3sNwjyvNvCWY9kdZGZfCSDV1ikz25A4` performed approve + bridge operations to Allbridge:

- Bridge contract: `TAuErcuAtU6BPt6YwL51JZ4RpDCPQASCU2`
- TRON pool recipient: `TAC21biCBL9agjuUyzd4gZr356zRgJq61b`
- BSC recipient: `0x3c38a410a09539b9bdeea3e5723dbf68c2d282da`
- BSC token: `0x55d398326f99059fF775485246999027B3197955` (BSC USDT)

TRON bridge transfer hashes and amounts:

| Tx | Amount |
|---|---:|
| `90d82348b20009cda48a2294233c888a89f3133c21855044f115719f14c52122` | `999 USDT` |
| `7ce8a55b8a7425bc496baf062f31768950c916db513cb055e372095be986fdea` | `11,111 USDT` |
| `01e5c06f7f8eee18deccc8edbca441d51126fdc3643caab7fe25c45053236d50` | `11,111 USDT` |
| `47f1e01d0eae1b7fde43bd9257544e239bbf9f757898f9e4ad6390b51e35dad3` | `33,333 USDT` |
| `54b7b1819697968bf3ac46378b444670a68d243d46cd55b4726e3729e5a6b096` | `33,333 USDT` |
| `03a26c5312143c09fc65dfcc570edec3208f865410aa740926e15ae5abff966b` | `55,555 USDT` |
| `15bd5bb0099a257a9db06c953be81c4460c971de7ccf981e8ac077bef2a263f2` | `55,555 USDT` |
| `76af017faa38d52d6aa76d3925b89cfd8f4732685d1fd5269ad05b83f40c6033` | `55,555 USDT` |
| `8b248778a8df3223470b76d3a9f8809d77f29cbbf8e9b909adbaf674bc92ec64` | `55,200 USDT` |

Total bridged from TRON side: `311,752 USDT`.

BSC received by `0x3c38...` from Allbridge LP-USDT: `309,899.218851 USDT`.

## BSC Movement

`0x3c38a410a09539b9bdeea3e5723dbf68c2d282da` sent the BSC USDT to `0xF874c3Ed7196B5Dc72B6D83a8d30B2aF290A815F`:

| Time UTC | Tx | Amount |
|---|---|---:|
| 2026-05-09 23:46:34 | `0x4a5a2104e0f90e4f78ac49663d32b59c2cdd59353da17f7aa94c0d3c61f1def2` | `10 USDT` |
| 2026-05-09 23:49:26 | `0x56097e079fee279970992b509ca7ac6ff974577647ab800cee22ffaecbcdc369` | `309,889.218851 USDT` |

`0xF874...` then sent USDT to five destination accounts:

| Time UTC | Tx | To | Amount |
|---|---|---|---:|
| 2026-05-10 00:20:17 | `0x754481b815c36f0895f2c7301e2eb9e4a224e31907d45db18d3d5a2d450903e9` | `0x2ca3236fe3242dca6c359052f7a938c2b0633a2e` | `2,000 USDT` |
| 2026-05-10 00:36:27 | `0x5fae4a397c3dfc9dbd3d34b25346747fb6e631b900891d31c874eba75e5eee9b` | `0x2964307c615ec2f1b1cf6c9a40d7331a6539c014` | `7,899 USDT` |
| 2026-05-10 00:49:28 | `0xdeda01c8271a90f7469b2c1660daff2c364da03397a0fc69106b1a297248ec1f` | `0x94b3bb4774043f9fea7b7f81e94c6f8c0a94e604` | `10,000 USDT` |
| 2026-05-10 00:55:48 | `0x660960725f05c2d1af6e33370abc1d3c902d50ff5479225b7e7732c65963921e` | `0xd33b46a404a9cc8437982c741e4f686a266d87e3` | `20,000 USDT` |
| 2026-05-10 01:01:22 | `0x43849bd1226858b77de82919203a0abfc5f5590442e94d107b566c4a590793ad` | `0x3630b5208ab890bc335032de9e6eb5c4e7651eaf` | `30,000 USDT` |

Subtotal: `69,899 USDT`.

Remaining large swap:

- Tx: `0x15b08831d6782a063046ccfa904d1717e5f64fdd22192bff6475d27f269d5a55`
- Time: 2026-05-10 01:30:45 UTC
- From: `0xF874c3Ed7196B5Dc72B6D83a8d30B2aF290A815F`
- Contract interacted: `0x1a1ec25dc08e98e5e93f1104b5e5cdd298707d31`
- Main outgoing token amount: `240,000.220696789218851 USDT`

BNB movement:

| Time UTC | Tx | From | To | Amount |
|---|---|---|---|---:|
| 2026-05-10 12:49:08 | `0xacb0acccd40a1503a2941e92368d248b1f7dbcf1b7f30207b6b549f475274f97` | `0xF874...` | `0xA585014b608785B51745a051DF5BE1BEaaa03CA8` | `0.11426831059691402 BNB` |
| 2026-05-10 12:50:00 | `0x5c038c0fcbb27197658acf367b497033faba095416f4e9e311c499da4174c1fa` | `0xF874...` | `0xA585014b608785B51745a051DF5BE1BEaaa03CA8` | `367.99997879 BNB` |
| 2026-05-13 13:33:53 | `0x9f2db119309e0fad312a554f9effc9afaa77148225350f5a4e4370070549c041` | `0xA585...` | `0x282Fb3eE9Cf2021bAB66E301aE7c77185Bb41E3f` | `100 BNB` |

Later USDT/USDC leg:

| Time UTC | Tx | Movement |
|---|---|---|
| 2026-05-13 12:40:35 | `0xfe9ca5142001bd0df11537c6bb194289310245b8aa0ffd40814a7148061af496` | `55,593 USDT` from `0xCC1540...` to `0xD2E864...` |
| 2026-05-13 13:32:25 | `0xdbf7c751a7226a56e3a0fc4422ba59606c2d2904d54c55d8a5f9a36cbe2190f3` | `55,586.44006147337 USDC` from `0x392131...` to `0xb3eE66...` |
| 2026-05-13 13:34:44 | `0x89b1a4800bc9ff19905e0181963d2c84d82e86da049cba52376cb8943848f72e` | `17,000 USDC` from `0xb3eE66...` to `0xeadE9c...` |
| 2026-05-13 13:42:54 | `0xc73b6fff8cc6495e8aee2958d3ecc9d2046170e793c416f5ebe99c68799396c8` | `38,586.440078473366 USDC` from `0xb3eE66...` to `0xeadE9c...` |

Total to `0xeadE9c792279B4b86153529D44f02Ceef97609e6`: approximately `55,586.440078473366 USDC`.

## How The "Invisible Smart Contract" Effect Happens

TRON USDT is the only token contract needed for the theft mechanics:

1. Victim signs `approve(spender, 2^256-1)` on the official USDT TRC20 contract.
2. The approved spender is a normal address, not a contract.
3. Later that normal address signs `transferFrom(victim, recipient, amount)`.
4. USDT contract checks allowance and balance, then transfers funds.
5. Wallet/explorer may show the approved spender as `Unknown address` because it is an unlabeled EOA.

This makes it look like "nothing was signed at the time of theft", because the meaningful signature happened days earlier as an approval.

## Immediate Mitigation Notes

- Revoke the USDT approval from victim to `TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj` immediately, even though funds are already gone.
- Treat the victim wallet as compromised or unsafe until the signing environment is understood.
- Check all active approvals on TRON for this wallet and any operational hot wallets.
- If this was an exchange hot wallet, rotate keys and review recent signing UI/browser/device history around 2026-05-06 19:06 UTC.
- Send freeze/escalation requests to Allbridge, KuCoin, Bitget, and any CEX identified by the deposit addresses, with the root approval tx and final deposit txs.

