# Project Context

## Domain Terms

- **Fast Check**: quick address risk check that produces a `RiskReport` from local labels, graph signals, behavior signals, AML signals, stablecoin restriction state, service exposure context, and missing checks.
- **Deep Research**: deeper address forensic check that builds profile arrays, raw evidence, observations, coverage, and coverage debug output for one subject address.
- **Where Is Money**: money-origin check that traces balance-forming or recent-flow USDT provenance and produces a `WhereIsMoneyReport`.
- **Unified Wallet Risk**: wallet-level composition that combines Fast Check, Deep Research, and Where Is Money into one final score, one final level, and one final decision.
- **Hard Evidence Floor**: score floor for deterministic bad evidence such as active USDT blacklist, exact approval-drain provenance, exact high-risk provenance, or sanctioned service evidence.
- **Policy Floor**: score floor for source-policy decline evidence from Where Is Money that should not be diluted by layer weights.
- **Asset Continuation Floor**: score floor for verified non-USDT TRC20 continuation after USDT movement detected by Deep Research.
- **Pattern Floor**: score floor for suspicious wallet behavior patterns that are stronger than weak context but still capped below critical when hard evidence is absent.
- **Dampener**: score reduction applied only to weak or contextual score, not to hard evidence, policy, asset-continuation, or pattern floors.
- **Service-Boundary Context**: context where funds interact with a service, exchange, bridge, router, DEX, or contract boundary and public-chain provenance becomes less certain.
- **Deep Research Report Assembly**: the part of Deep Research that turns fetched transfers and detector outputs into profiles, raw evidence, observations, coverage, coverage debug output, and the final `DeepAddressForensicReport`.
- **Forensic Detector Pattern**: shared shape for code that detects one forensic signal, returns structured profiles, and lets an assembly layer persist evidence, observations, missing checks, and report fields.
