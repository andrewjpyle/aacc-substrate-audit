# Harbor Lane Bikes memory (SAMPLE DATA for the aacc-substrate-audit demo; fictional company)

## Lessons
- [Deploy only on Tuesday and Thursday mornings](feedback-deploy-window.md): a Friday deploy broke dock unlocks for a weekend.
- [Dry-run every bulk fare change](feedback_dry_run_fare_changes.md): a fare script once set 3,000 ride passes to $0.
- [Always dry-run bulk fare updates first](feedback-bulk-fare-dry-run.md): a fare script once set 3,000 ride passes to $0.
- [Rider GPS traces are kept 30 days](project-gps-retention.md): privacy policy commitment.

## Projects
- [Billing v2 migration](project-billing-v2.md): IN PROGRESS. Stripe-based billing replaces the legacy invoicing service; v1 still handles all charges; cutover planned for August; owner is the payments team; rollback plan is in docs/runbooks/billing-rollback.md; do not touch the legacy invoice tables until cutover; dual-write is enabled behind the BILLING_V2_DUAL_WRITE flag, which must stay on until finance signs off on the reconciliation report.
- [Dock firmware rollout](project-dock-firmware.md): stage 2 of 3, see tasks/dock_firmware.md.
