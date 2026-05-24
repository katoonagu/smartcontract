# Project State

Generated: 2026-05-23T17:35:20+00:00

## Initialization State

`.planning/` was initialized by ingesting the existing repository docs and code structure. This is an existing TypeScript project, not a blank scaffold.

Created planning files:

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/config.json`
- `.planning/INGEST-CONFLICTS.md`
- `.planning/research/INDEX.md`

## Repository Snapshot

Project name from `package.json`: `tron-usdt-monitoring-bot`.

Current top-level artifacts:

- `README.md`
- `PRODUCT-IDEA-BLOCKCHAIN-BOT.md`
- `FORENSIC-REPORT.md`
- `docs/research/`
- `docs/superpowers/plans/`
- `docs/superpowers/specs/`
- `migrations/001_init.sql` through `009_contract_intelligence_profiles.sql`
- `src/`
- `tests/`

## Verification Performed During Initialization

Commands run:

```bash
npm run typecheck
npx vitest run --configLoader runner
```

Results observed before final verification:

- TypeScript typecheck passed.
- Vitest passed with `--configLoader runner`: 24 test files, 231 tests.

A plain `npm test` initially failed because Vite tried to write bundled config output under root-owned `node_modules/.vite-temp`. The package scripts were updated to use `--configLoader runner`, which avoids that temp-write path and makes the normal `npm test` command usable in this environment.

## Current Decisions

- Treat `README.md` and current code/tests as the source of truth for implemented functionality.
- Treat `PRODUCT-IDEA-BLOCKCHAIN-BOT.md` as product vision and backlog input, not a claim of live functionality.
- Treat research docs as future-phase input unless corresponding code/tests/migrations exist.
- Keep all blockchain/wallet functionality read-only.
- Keep risk intelligence deterministic and evidence-first.
- Do not introduce AML provider, graph-forensics, B2B, or multi-chain claims until dedicated phases implement and verify them.

## Next Recommended Action

Plan and execute Phase 10: **Source Labels And Free Signals**.

Suggested first planning prompt:

```text
Create a Phase 10 implementation plan for source-backed public/free risk labels. Use .planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/ROADMAP.md, docs/research/2026-05-20-risk-signals-research.md, and docs/research/2026-05-23-drain-pattern-hypotheses.md.
```

## Open Questions

- Which public/free sources are legally and operationally acceptable to import first?
- Should source labels expire automatically or require manual review?
- What evidence URL/source fields are safe to expose to end users versus service admins only?
- Should Phase 10 include an admin Telegram command, a CLI import script, or both?
- What is the minimum B2B audit model needed before exposing webhooks/API?
