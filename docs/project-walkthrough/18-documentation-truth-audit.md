# Documentation Truth Audit

## Purpose

This document checks whether the plain-language walkthrough accurately describes the current project.

Each claim gets one status:

- `confirmed` - supported by current code, tests, or saved job output.
- `partial` - directionally true, but wording must be narrower.
- `outdated` - docs describe behavior that changed.
- `future` - useful product direction, but not current behavior.
- `needs evidence` - likely true, but not yet tied to a code/test/job reference.

## Audit Rules

- Do not invent numbers.
- Prefer code and tests over memory.
- If a value is configurable, document where it comes from.
- If a rule is heuristic, say that it is a heuristic.
- If a mode only stores data for admin and does not show it in Telegram, say that.
- If a graph cannot prove source of funds, say that.

## Claim Matrix

| ID | Topic | Claim | Current docs | Evidence | Status | Numbers / rules | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C-001 | Check modes | FastCheck, DeepCheck, and Where is money are separate modes with different goals. | `06-check-modes...` | `src/bot/createBot.ts`, `src/forensics/deepForensicJob.ts`, tests | needs evidence | none yet | Verify and update wording. |

## Confirmed Numbers

| Area | Number / rule | Evidence | Notes |
| --- | --- | --- | --- |

## Partial Or Future Claims

| Claim | Why not fully confirmed | Safer wording |
| --- | --- | --- |

## Open Questions

| Question | Why it matters | Owner decision needed |
| --- | --- | --- |
