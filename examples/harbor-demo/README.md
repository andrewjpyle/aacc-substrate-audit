# Harbor Lane Bikes demo (fictional, sample data)

Everything here is made up for the aacc-substrate-audit demo: a bike-share company that does not
exist, a small project (`CLAUDE.md`, `docs/`, `tasks/`, `jobs/`), and a deliberately messy sample
Claude Code memory in `memory/`.

## What is planted

| Planted problem | Where |
|---|---|
| Contradiction: deploy days | memory says Tuesday and Thursday only; `CLAUDE.md` says any weekday |
| Contradiction: GPS retention | memory says 30 days; `CLAUDE.md` says 90 days |
| Stale claim | memory says billing v2 is IN PROGRESS; `docs/SESSION-NOTES.md` says it shipped on 2026-08-14 |
| Duplicate (copy, not pointer) | `feedback_dry_run_fare_changes.md` and `feedback-bulk-fare-dry-run.md` hold the same lesson, one with each prefix spelling |
| Dead reference | `docs/runbooks/billing-rollback.md` does not exist |
| MEMORY.md bloat | the billing v2 index line carries a paragraph of detail |

`audits/substrate_audit_2026-10-01.md` is the **unedited** report from a real run of
`substrate_audit_workflow.js` on this demo. The README's graphics are rendered from it.

`audits/before_fix/substrate_audit_2026-10-01.md` is the unedited report from the first run, one
commit earlier (91330f5). Its dead-reference check flagged 8 paths; 7 were false positives (six
`MEMORY.md` links and a feature-flag name). That run is why the script now settles memory links
itself before the check. It also shows the synthesizer writing a second coverage paragraph with a
wrong file count, which is why the coverage block is now script-only.

## Reproduce it

1. Copy this folder except `memory/` and `audits/` to a new directory and `cd` there. Run `git init`
   if you like; inside git, the memory dir is keyed on the repository's main checkout.
2. Copy `memory/` to that project's Claude Code memory dir:
   `~/.claude/projects/$(pwd | sed 's/[^A-Za-z0-9]/-/g')/memory/`
3. In Claude Code, run `/aacc-substrate-audit`.

Model output varies run to run, so your wording will differ; the planted problems should still be found.
