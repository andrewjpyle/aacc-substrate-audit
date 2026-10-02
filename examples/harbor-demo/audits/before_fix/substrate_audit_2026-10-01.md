# Knowledge-substrate audit: harbor-lane-demo (prune/merge proposal)

## Coverage

- Memory dir: ~/.claude/projects/-private-tmp-harbor-lane-demo/memory
- Files: 7 memory, 1 CLAUDE.md, 1 session docs, 1 task/spec files, 1 project docs
- Reader groups: 5 of 5 completed
- Dead-reference check: checked 12 paths, 8 dead
- Nothing was edited. Every item below is a proposal.

All items are proposals; nothing was edited.

**Coverage:** I checked all 11 files in ~/.claude/projects/-private-tmp-harbor-lane-demo/memory (7 memory files including MEMORY.md), CLAUDE.md, docs/SESSION-NOTES.md, docs/architecture.md and tasks/dock_firmware.md. All 5 reader groups finished. The dead-reference check ran (12 paths checked, 8 flagged). I re-checked those 8 by hand and only 1 is really broken (see below).

## Summary

- **Highest risk: stale billing guidance.** project-billing-v2.md and the MEMORY.md index say billing v2 is IN PROGRESS, that "v1 still handles all charges", that the BILLING_V2_DUAL_WRITE flag "must stay on", and that the legacy invoice tables must not be touched. SESSION-NOTES (2026-08-14) and architecture.md say the cutover is done, the flag was removed and the legacy service was retired and its tables archived. An agent following the memory would act on a system that no longer exists.
- **Two rules contradict each other and need an owner to decide:** GPS retention (30 vs 90 days) and the deploy window (Tuesday/Thursday only vs any weekday).
- **One near-word-for-word duplicate memory** (fare dry-run), and it has two lines in the index.
- **One truly dead reference:** docs/runbooks/billing-rollback.md.
- **Dock firmware** stage status is copied into memory instead of pointing to the task file. It matches today but will drift once Stage 3 ships.

## Dead references to fix

1. **docs/runbooks/billing-rollback.md (truly dead).** It is referenced by `~/.claude/projects/-private-tmp-harbor-lane-demo/memory/project-billing-v2.md` (line "Rollback plan: docs/runbooks/billing-rollback.md.") and by the Billing v2 line in `MEMORY.md`. The docs/runbooks/ directory does not exist, and a rollback plan no longer matters after the cutover. **Change:** delete the reference from both files. Do not create the runbook. Billing item 1 below covers this.
2. **False positives. Do not act on these; fix the checker instead.** `feedback-deploy-window.md`, `feedback_dry_run_fare_changes.md`, `feedback-bulk-fare-dry-run.md`, `project-gps-retention.md`, `project-billing-v2.md` and `project-dock-firmware.md` all exist in the memory directory. The checker looked them up from the project root. `BILLING_V2_DUAL_WRITE` is a feature-flag name, not a path. Its mention still goes away under billing item 1 because it is stale.

## Contradictions to resolve

1. **Billing v2 status (resolved by evidence).** Memory says IN PROGRESS and planned for August. SESSION-NOTES 2026-08-14 and architecture.md say it is DONE and the legacy service retired in August 2026. Two independent project docs agree, so trust them and fix the memory. See Stale/shipped item 1.
2. **GPS retention: 30 vs 90 days (owner decision needed).**
   - `memory/project-gps-retention.md`: "deleted after 30 days. This is a commitment in the public privacy policy."
   - `memory/MEMORY.md`: "Rider GPS traces are kept 30 days".
   - `CLAUDE.md`: "Rider GPS traces are kept for 90 days for theft investigations, then purged."
   - `jobs/purge_gps.py` is a placeholder and does not settle it.
   - **Proposed change:** keep the privacy-policy value (30 days) as canonical in `memory/project-gps-retention.md`. Replace the CLAUDE.md line with "GPS retention: see the privacy-policy commitment (memory project-gps-retention); purge job jobs/purge_gps.py." This is the safer default because a public legal commitment outranks an internal convention. If the owner confirms the policy changed to 90 days, update the memory file and the MEMORY.md line instead.
3. **Deploy window (owner decision needed).**
   - `memory/feedback-deploy-window.md` and its MEMORY.md line: Tuesday and Thursday mornings only, never Fri/Sat/Sun. The rule comes from an incident in 2026-04.
   - `CLAUDE.md`: "Deploys go out any weekday morning after the test suite passes. Avoid weekends."
   - **Proposed change:** keep the stricter, incident-backed rule. Change the CLAUDE.md line to "Deploy only Tuesday and Thursday mornings after the test suite passes; never Fri/Sat/Sun." If the team has deliberately relaxed the rule, edit `feedback-deploy-window.md` and its index line instead. Keep a single statement either way.

## Stale/shipped to unflag

1. **`memory/project-billing-v2.md` (high impact).** Replace the body after the SAMPLE DATA line with: "Status: SHIPPED 2026-08-14. All charges go through Stripe (billing v2). The legacy invoicing service is retired and its tables are archived; the BILLING_V2_DUAL_WRITE flag was removed. Details: docs/architecture.md, docs/SESSION-NOTES.md (2026-08-14)." This removes "IN PROGRESS", "v1 still handles all charges", "Cutover is planned for August 2026" and the dead rollback-plan line. You could also delete the file outright, since architecture.md already records the fact. Rewriting it is the conservative choice.
2. **The Billing v2 line in `memory/MEMORY.md` (high impact).** Remove "IN PROGRESS", "v1 still handles all charges", "cutover planned for August", "do not touch the legacy invoice tables until cutover" and "BILLING_V2_DUAL_WRITE flag, which must stay on until finance signs off". The exact replacement line is under the MEMORY.md bloat section.
3. **Dock firmware wording (low impact, not wrong today).** "Stage 2 (Eastside) is live" in `project-dock-firmware.md` and "stage 2 of 3" in MEMORY.md both match tasks/dock_firmware.md (stages 1 and 2 checked, stage 3 open). But SESSION-NOTES 2026-09-02 said Stage 3 would start "next week", so it may already be under way. The fix is to point to the task file rather than restate the stage. See Copy-not-pointer item 2.

## Copy-not-pointer to convert

1. **Duplicate fare dry-run memories (high impact, easy).** `memory/feedback_dry_run_fare_changes.md` and `memory/feedback-bulk-fare-dry-run.md` describe the same 2026-02 incident, give the same reason and set the same 500-pass abort rule. **Change:** delete `feedback-bulk-fare-dry-run.md` and remove its MEMORY.md line "- [Always dry-run bulk fare updates first](feedback-bulk-fare-dry-run.md): a fare script once set 3,000 ride passes to $0." Keep `feedback_dry_run_fare_changes.md` unchanged. CLAUDE.md's one-line "Bulk fare changes always run with `--dry-run` first" is fine as a short convention. If you want it to point to the source, add "(see memory feedback_dry_run_fare_changes: abort if >500 passes change)".
2. **Dock firmware progress (medium impact).** `tasks/dock_firmware.md` is the source of truth for which stages are done. **Change:** in `memory/project-dock-firmware.md`, replace "Stage 2 (Eastside) is live." with "Current stage: see tasks/dock_firmware.md." In `MEMORY.md`, change ": stage 2 of 3, see tasks/dock_firmware.md." to ": three-stage rollout; progress in tasks/dock_firmware.md." SESSION-NOTES is a dated log, so leave it alone.
3. **GPS retention is written in three places (medium impact).** Once Contradiction 2 is settled, keep the value in exactly one file and turn the other two into pointers, as described there.
4. **GPS purge job named in both memory and architecture.md (minor).** You may leave the `jobs/purge_gps.py` mention in `project-gps-retention.md` as it is, or replace it with "Purge job: see docs/architecture.md." Low value either way.

## MEMORY.md bloat to graduate to topic files

1. **The Billing v2 line** in `~/.claude/projects/-private-tmp-harbor-lane-demo/memory/MEMORY.md` is a run-on paragraph. It covers status, owner, rollback path, a table freeze, a feature flag and finance sign-off. Most of that (owner, table freeze, flag, finance sign-off) is not in the topic file at all, and all of it is now stale. So nothing needs to move to the topic file; it just needs deleting. **Replace the whole line with:** `- [Billing v2 migration](project-billing-v2.md): shipped 2026-08-14 (Stripe); legacy retired.`
2. Other index lines are already short pointers. None found beyond item 1.
