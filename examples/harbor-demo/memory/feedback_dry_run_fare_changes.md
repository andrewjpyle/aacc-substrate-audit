---
name: feedback_dry_run_fare_changes
metadata:
  type: feedback
---
SAMPLE DATA: fictional Harbor Lane Bikes, written for the aacc-substrate-audit demo.

In 2026-02 a fare update script set 3,000 annual ride passes to $0 because a CSV column was empty.

**Why:** A bulk write with no preview turns one bad input into thousands of bad rows.

**How to apply:** Every bulk fare change runs with `--dry-run` first and prints the row count and a sample diff. Abort if more than 500 passes change.
