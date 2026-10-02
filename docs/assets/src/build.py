"""Build the README graphics for aacc-substrate-audit.

    python docs/assets/src/build.py
    uv run --with playwright==1.56.0 --with pillow python docs/assets/src/render.py docs/assets/src docs/assets

hero and architecture are structural: the finding categories and the phases are read from
substrate_audit_workflow.js, so they cannot drift from the code. anatomy and planted render ONLY from
captures/demo_report.json, a real run of this skill against the fictional Harbor Lane Bikes demo in
examples/harbor-demo (sample memory, sample project; no real user's memory is shown). planted also
reads the list of planted problems from examples/harbor-demo/README.md and fails the build if the
captured report does not mention one of them.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import readme_kit as k  # noqa: E402

REPO = "AACC-SUBSTRATE-AUDIT"
SRC = (ROOT / "substrate_audit_workflow.js").read_text(encoding="utf-8")
CAPTURE = HERE / "captures" / "demo_report.json"

CATEGORY_NAMES = {"referenced_paths": "Dead ref", "contradictions": "Conflict", "stale_candidates": "Stale",
                  "copy_not_pointer": "Copies", "bloat_candidates": "Bloat"}


def categories() -> list[str]:
    """The reader's finding categories, from READER_SCHEMA's required list in the workflow."""
    block = SRC[SRC.index("const READER_SCHEMA"):SRC.index("const DEADREF_SCHEMA")]
    req = re.search(r"required: \[([^\]]+)\]\s*,?\s*\}\s*$", block.strip(), re.S).group(1)
    keys = re.findall(r"'([a-z_]+)'", req)
    assert keys == list(CATEGORY_NAMES), f"READER_SCHEMA categories changed: {keys}"
    return [CATEGORY_NAMES[x] for x in keys]


def phases() -> list[tuple[str, str]]:
    """(title, detail) for each phase in the workflow's meta block."""
    out = re.findall(r"\{ title: '([^']+)', detail: '([^']+)' \}", SRC)
    assert [t for t, _ in out] == ["Manifest", "Scan", "Verify refs", "Synthesize"], out
    return out


def hero() -> str:
    return k.hero(
        "AACC-SUBSTRATE-AUDIT · CLAUDE CODE SKILL · MIT",
        "Find the drift", "in your agent's memory.",
        "A read-only audit of Claude Code memory, CLAUDE.md and project docs. Reader agents fan out, then one "
        "<b style='color:var(--ivory);font-weight:600'>prioritized prune/merge proposal</b> comes back.",
        [("The right memory, exactly", "Claude Code's own path rule. Never another project's memory."),
         ("Gaps are named", "A failed reader is NOT AUDITED, never counted as clean."),
         ("Proposes, never edits", "Every agent is read-only. Applying a fix is your call.")],
        "1 MANIFEST · N READERS · 1 CHECKER · 1 SYNTHESIS",
        k.wheel(categories(), "PROPOSAL", "Prune", size=560, node_r=56),
        f"{REPO} · HOW IT WORKS")


def architecture() -> str:
    ph = dict(phases())
    boxes = (k.box(56, 230, 250, 190, "SUBSTRATE", ["auto-memory/*.md", "MEMORY.md index", "CLAUDE.md", "docs/, tasks/"])
             + k.box(56, 450, 250, 190, "EXACT MEMORY DIR", ["git main checkout", "or the cwd,", "non-alphanumerics", "as \"-\""])
             + k.box(376, 350, 230, 160, "MANIFEST · HAIKU", ["list every file", "drop memory paths", "outside the one dir"])
             + k.box(676, 230, 280, 410, "READERS · SONNET", ["in parallel:", "", "5 memory files each", "CLAUDE.md + notes", "tasks", "project docs", "", "each greps the rest", "for conflicts + copies", "", "failed = NOT AUDITED"], True)
             + k.box(1026, 230, 318, 130, "VERIFY REFS · HAIKU", ["memory links settled", "by the script first", "then test -e on disk"])
             + k.box(1026, 390, 318, 110, "SYNTHESIZE · OPUS", ["rank by impact", "name file + change"], True)
             + k.box(1026, 530, 318, 110, "REPORT", ["Coverage block first", "./audits/<date>.md"]))
    arrows = [(306, 325, 366, 400), (306, 545, 366, 460), (606, 430, 666, 430), (956, 295, 1016, 295),
              (956, 445, 1016, 445), (1185, 500, 1185, 522)]
    assert len(ph) == 4
    return k.flow("HOW IT WORKS", f"Manifest, scan, verify, {k.em('synthesize')}. Never edit.",
                  "every agent is the read-only Explore type · the Coverage block is written by the script, not a model",
                  boxes, arrows, f"{REPO} · HOW IT WORKS")


def run_date(c: dict) -> str:
    """The run's local date, from the report's file name (captured_at is UTC)."""
    return re.search(r"substrate_audit_(\d{4}-\d{2}-\d{2})\.md", " ".join(c["command"])).group(1)


def anatomy() -> str:
    c = k.load_capture(CAPTURE)
    md = c["output"]
    title = re.search(r"^# (.+)$", md, re.M).group(1)
    cov = re.search(r"## Coverage\n\n((?:- .+\n)+)", md).group(1).strip().splitlines()
    sections = re.findall(r"^## (.+)$", md, re.M)
    lines = [("h1", k.esc(title)), ("h2", "Coverage (written by the script)")]
    for line in cov:
        lines.append(("code", k.esc(line)))
    lines.append(("h2", "Sections, each item names a file and the exact change"))
    for s in sections:
        if s in ("Coverage", "Summary"):
            continue
        body = md.split(f"## {s}\n", 1)[1].split("\n## ", 1)[0]
        first = re.search(r"^1\. \*\*(.+?)\*\*", body, re.M)
        n = len(re.findall(r"^\d+\. ", body, re.M))
        lead = first.group(1).replace("`", "").rstrip(".") if first else "none found"
        lead = re.sub(r"~/\.claude/projects/[^/]+/memory/", "memory/", lead)
        lines.append(("li", f"<b style='color:var(--amber)'>{k.esc(s)}</b> <span class='mono' style='font-size:12px;color:var(--dim)'>{n} items</span>"))
        lines.append(("li2", k.esc(lead[:78])))
    lines.append(("m", f"examples/harbor-demo · fictional sample data · run {run_date(c)}"))
    readers = re.search(r"Reader groups: (\d+ of \d+) completed", md).group(1)
    links = re.search(r"; (\d+) memory links resolved", md).group(1)
    notes = [(166, "The memory dir is the exact one for this project, shown with ~ so reports can be shared."),
             (222, f"{readers} readers completed. A failed one would be listed here as NOT AUDITED."),
             (278, f"{links} MEMORY.md links resolved by the script, so the checker cannot misread them as dead."),
             (392, "Ranked by impact: the stale billing status is the first contradiction."),
             (580, "Real run, unedited report. The company and its memory are fictional.")]
    return k.anatomy("ANATOMY OF A REAL AUDIT", lines, notes, f"{REPO} · REAL RUN {run_date(c)} · SAMPLE DATA: HARBOR LANE", doc_width=840)


# Keyword that must appear in the captured report for each planted problem (README table order).
PLANTED_EVIDENCE = [
    ("Contradiction: deploy days", r"Deploy window", "Tuesday and Thursday"),
    ("Contradiction: GPS retention", r"GPS trace retention", "90 days"),
    ("Stale claim", r"IN PROGRESS", "2026-08-14"),
    ("Duplicate (copy, not pointer)", r"exists twice in memory", "feedback-bulk-fare-dry-run.md"),
    ("Dead reference", r"docs/runbooks/billing-rollback\.md", "billing-rollback.md"),
    ("MEMORY.md bloat", r"MEMORY.md bloat to graduate", "line 10 (Billing v2)"),
]


def planted() -> str:
    c = k.load_capture(CAPTURE)
    md = c["output"]
    readme = (ROOT / "examples" / "harbor-demo" / "README.md").read_text(encoding="utf-8")
    rows = re.findall(r"^\| ([^|]+?) \| ([^|]+?) \|$", readme, re.M)[1:]
    assert [r[0] for r in rows] == [p[0] for p in PLANTED_EVIDENCE], rows
    cards = []
    for (label, pattern, quote), (_, where) in zip(PLANTED_EVIDENCE, rows):
        assert re.search(pattern, md), f"captured report does not mention planted problem: {label}"
        assert quote in md, f"captured report lacks '{quote}'"
        short = label.replace("Contradiction: ", "Conflict: ").replace(" (copy, not pointer)", "")
        cards.append((short.upper(), re.sub(r"`", "", where), f"FOUND: \"{quote}\"", "in the captured report"))
    checked, ndead = re.search(r"Dead-reference check: checked (\d+) paths, (\d+) dead", md).groups()
    planted_dead = sum(1 for r in rows if r[0] == "Dead reference")
    assert int(ndead) == planted_dead, f"report has {ndead} dead refs, demo plants {planted_dead}"
    return k.catalog("PLANTED VS FOUND", f"Six planted problems, {k.em('six')} found.",
                     f"Same run: {checked} referenced paths checked on disk, {ndead} dead, and it is the planted one.",
                     cards, f"{REPO} · REAL RUN {run_date(c)} · SAMPLE DATA: HARBOR LANE", cols=3, card_height=200)


if __name__ == "__main__":
    pages = {"hero": hero(), "architecture": architecture(), "anatomy": anatomy(), "planted": planted()}
    k.write_pages(HERE, pages)
