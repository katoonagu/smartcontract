# Plan 5 release evidence

Status: release candidate; production rollout is pending explicit GO.

Task 7 prepares manual Telegram evidence for the exact candidate SHA and
runtime label. It uses the 15 ordered `MANUAL_TELEGRAM_ACCEPTANCE_CASES`, which
produce exactly 19 message records and 11 golden comparisons. Every message is
bound to its fixture ID, checked wallet, synthetic terminal job, payload hash,
Telegram message ID and screenshot hash.

After the sanitized seed step, the Task 7 persister writes
`manual-telegram-candidate-run.json` once. The finalizer and release verifier
read that independent immutable run; job IDs are never reconstructed from the
review evidence being validated.

The candidate payload generator uses the real Where, Deep, Incoming, Approval,
Contract and technical presentation paths. Synthetic jobs exist only in
`tron_watch_plan5_runtime_sanitized`. Their delivery evidence is stored under a
non-claimable result key; `progress_json.telegramDelivery` is forbidden. The
sanitized runtime transport remains `recording_disabled` and sends nothing.
Seeding and final verification recompute the PostgreSQL cluster/database
fingerprint and require an exact Task 0B match plus verified schema 032.

Manual sending is a separate one-shot Task 9 action. It requires dedicated test
credentials, a non-production chat, explicit send authorization and production
references proving token/chat inequality. It sends the frozen 19 payloads once,
without retries or polling. Its journal stores only candidate/runtime binding,
job ID, Telegram message ID and payload hash—never a token, chat/user ID or
Telegram response body. The hash covers text, parse mode and reply markup, not
the secret routing destination. A partial journal blocks a blind rerun, and the
finalizer rejects evidence unless all 19 journal records and `complete.json`
match the immutable candidate run.

Screenshots must be regular, non-symlink PNG files inside the protected external
artifact root with a valid PNG signature and bounded size. Finalization
recomputes every screenshot and payload SHA-256,
rejects missing/duplicate/foreign records, and creates
`manual-telegram-acceptance.json` without overwriting existing evidence.

The allowlisted operational entry point is a three-state command. With no
action variable it performs only `prepare`: it verifies the candidate/runtime,
Task 0B, loopback `tron_watch_plan5_runtime_sanitized` identity and schema 032,
seeds the 19 non-claimable terminal jobs, and writes the immutable run. It does
not call Telegram.

```powershell
npm run release:telegram:manual -- <protected-outside-repo-root>
```

`send` and `finalize` are never inferred. Sending additionally requires
`PLAN4_TELEGRAM_ALLOW_SEND=1`, dedicated
`PLAN4_TELEGRAM_TEST_BOT_TOKEN`/`PLAN4_TELEGRAM_TEST_CHAT_ID`, and the current
production `BOT_TOKEN`/`SERVICE_ADMIN_TG_IDS` references solely to prove the
test destination is different. A partial send journal is terminal and blocks a
blind rerun.

```powershell
$env:PLAN5_TELEGRAM_MANUAL_ACTION = "send"
npm run release:telegram:manual -- <protected-outside-repo-root>

$env:PLAN5_TELEGRAM_MANUAL_ACTION = "finalize"
npm run release:telegram:manual -- <protected-outside-repo-root>
```

`prepare` and `finalize` require
`PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL`; `send` never changes the stored
jobs, while `finalize` re-verifies them and accepts only a complete journal,
complete screenshots and the exact 15/19/11 pending review evidence.

```powershell
npm run release:telegram:finalize -- `
  <protected-outside-repo-root> `
  <40-char-candidate-sha> `
  <candidate-runtime-label>
```

This document does not authorize a production migration, runtime restart or
working Telegram update. Those actions remain blocked until Task 9, all
`G00…G11` gates, merge/reverification on `master`, and a separate explicit GO.
