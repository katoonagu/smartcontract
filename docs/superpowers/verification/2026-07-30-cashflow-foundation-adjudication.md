# Cashflow Shadow Foundation Adjudication

- reviewer: `codex-independent-cashflow-foundation-review`
- reviewed_at: `2026-07-30`
- decision: `accepted`
- corpus_commit: `ecfa4bc8738ade065d4c5ff3bbdd1855d14898ad`
- initial_corpus_commit: `523474c91f6770f002aa60dc30753fed9fba7132`
- foundation_commit: `d80a7e0100665c9d46a13d1b6da26bd48b2c6898`
- source_commit: `28e91d1521df6cc3aa3c31f56e25dfbd5590a343`
- source_sha256: `ec4ec56875ddee7b040835a12d31a2916d026afee80ae20560d7be7582712ec8`
- snapshot_block_commit: `25af73c3580bda282bbd54b79ee6eec62504a553`
- snapshot_block_sha256: `6d406fd8f7c2efa62cd89bb384a71771649102a0a513106bc0632f28560e9227`
- source_review_commit: `efd03ad854cb2e412e6b24605d67fc738a49c5ec`
- source_review_sha256: `6320bbde801c8b3ed6eca4d35200a0a023096584915a1173aeab709ece947cf8`
- tape_commit: `8d1e1c3ce9d275f091f6613627142232f4d335e0`
- tape_file_sha256: `a99bf6a464ed56a286fc97f6c15af2b0546aece7648c3069f306a6d06503c5b3`
- tape_artifact_sha256: `cef9b2e58e4768d977d2a9593574fb106cf07c08ef817a49d8033a81165de9c7`
- tape_acceptance_commit: `c6d1777c8fd98444e812b059461bdd5b85979b4b`
- tape_acceptance_sha256: `86b3f515319436aa5262dda270903fee466144948defd481e978d1e2d9411e14`
- real_pacgy_authoritative: `false`
- production_runtime_authorized: `false`

## Seven Normalized Actuals

```json
[
  {"caseId":"debit-over-inventory-control","actual":{"state":"unresolved","reason":"outgoing_exceeds_reconstructed_inventory","authoritative":false,"targetRaw":"0","coveredRaw":"0","allocations":[]}},
  {"caseId":"exact-self-transfer-control","actual":{"state":"complete","reason":null,"authoritative":true,"targetRaw":"10","coveredRaw":"10","allocations":[{"lotId":"receipt:in-10:0","sourceEventId":"receipt:in-10:0","sourceAddress":"funder","usedAmountRaw":"10","sourceOriginalRaw":"10"}]}},
  {"caseId":"identity-collision-control","actual":{"state":"unresolved","reason":"canonical_event_identity_unresolved","authoritative":false,"targetRaw":"0","coveredRaw":"0","allocations":[]}},
  {"caseId":"integer-remainder-control","actual":{"state":"complete","reason":null,"authoritative":true,"targetRaw":"2","coveredRaw":"2","allocations":[{"lotId":"receipt:in-a:0","sourceEventId":"receipt:in-a:0","sourceAddress":"a","usedAmountRaw":"1","sourceOriginalRaw":"1"},{"lotId":"receipt:in-b:0","sourceEventId":"receipt:in-b:0","sourceAddress":"b","usedAmountRaw":"1","sourceOriginalRaw":"2"}]}},
  {"caseId":"missing-order-control","actual":{"state":"unresolved","reason":"temporal_order_unresolved","authoritative":false,"targetRaw":"0","coveredRaw":"0","allocations":[]}},
  {"caseId":"pacgy-recorded-chronology","actual":{"state":"unresolved","reason":"history_incomplete_before_anchor","authoritative":false,"targetRaw":"0","coveredRaw":"0","allocations":[]}},
  {"caseId":"pacgy-synthetic-zero-opening-control","actual":{"state":"complete","reason":null,"authoritative":true,"targetRaw":"180000000","coveredRaw":"180000000","allocations":[{"lotId":"receipt:in-300:0","sourceEventId":"receipt:in-300:0","sourceAddress":"old","usedAmountRaw":"180000000","sourceOriginalRaw":"300000000"}]}}
]
```

## Independent Verification

| Command | Exit | Result |
|---|---:|---|
| Task 0 tracked/clean, hash, commit-binding, ancestry, and independent-review PowerShell gate | 0 | 5 prerequisites accepted; empty index; all hashes and chains matched |
| `npm.cmd test -- tests/forensics/chronologicalProportionalLedger.test.ts tests/forensics/chronologicalLedgerCorpusReplay.test.ts tests/forensics/offlineForensicModelReplay.test.ts` | 0 | 3 files; 158 tests passed |
| `npm.cmd test -- tests/forensics/cashflowCanonicalTape.test.ts tests/forensics/cashflowShadowArtifact.test.ts tests/forensics/chronologicalProportionalLedger.test.ts tests/forensics/chronologicalLedgerCorpusReplay.test.ts` | 0 | 4 files; 77 tests passed |
| `node --import tsx scripts/replayForensicModelCorpus.ts --group ledger` | 0 | matched; 7 cases; 0 expectation mismatches |
| PowerShell exact normalized-seven comparison against the frozen JSON above | 0 | all seven objects matched exactly |
| `npm.cmd test` | 0 | 294 files and 5,211 tests passed; 27 files and 157 tests skipped |
| `npm.cmd run typecheck` | 0 | `tsc --noEmit` passed |
| `git diff --check` | 0 | clean |
| `git diff --check c6d1777c8fd98444e812b059461bdd5b85979b4b..ecfa4bc8738ade065d4c5ff3bbdd1855d14898ad` | 0 | clean |

The accepted real tape binds the reviewed receipt and snapshot evidence to a
separate file-byte hash and to `fingerprintCanonicalArtifact(body)`. Its
history is partial, its opening balance and independent pinned balance are
absent, transaction order is unproven, and economic-role coverage is
incomplete. It therefore remains non-authoritative and resolves to
`history_incomplete_before_anchor`. The synthetic zero-opening `180/180`
calibration is separate and does not promote the real tape.

This decision accepts only the offline shadow foundation and its executable
seven-case ledger slice. It does not authorize production runtime,
configuration, persistence, jobs, selectors, indexing, scoring, traversal,
delivery, Stage C/D, canary, or activation work.
