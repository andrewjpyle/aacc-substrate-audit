---
name: feedback-bulk-fare-dry-run
metadata:
  type: feedback
---
SAMPLE DATA: fictional Harbor Lane Bikes, written for the aacc-substrate-audit demo.

In 2026-02 a fare update script set 3,000 annual ride passes to $0 because a CSV column was empty.

**Why:** A bulk write with no preview turns one bad input into thousands of bad rows.

**How to apply:** Run every bulk fare update with `--dry-run` first, check the row count and a sample diff, and abort if more than 500 passes change.
