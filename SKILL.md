---
name: aacc-substrate-audit
description: |
  Use this skill when the user invokes `/aacc-substrate-audit` (or asks to audit / clean up /
  prune the knowledge substrate, memory, MEMORY.md, CLAUDE.md, or asks "is anything stale or
  contradictory in my memory/docs"). Runs a read-only Dynamic Workflow that fans out reader
  agents across your project knowledge substrate (Claude Code auto-memory + MEMORY.md, CLAUDE.md,
  project docs, session notes, and any open task/spec files), then synthesizes a PRIORITIZED
  prune/merge proposal: dead file references, contradictions, stale/shipped-but-marked-open
  claims, copy-not-pointer duplication, and MEMORY.md bloat.

  It PROPOSES only — it writes an audit report to disk and never edits the substrate on its own.
  Applying any prune is a separate, user-approved step. Governing model: a pointer-not-copy rule
  — each fact has one system-of-record; other places point to it.

  Skip this skill for: editing a single known memory file (just edit it), questions about what
  a specific memory says (read it), or generating new memories (use the normal memory flow).
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
  - Glob
  - Workflow
---

# aacc-substrate-audit — Knowledge-substrate drift audit

A read-only self-audit of your project's operating substrate. As a project runs, its knowledge
substrate grows — Claude Code auto-memory files + MEMORY.md, CLAUDE.md, project docs, session
notes, and open task/spec files. Past a certain size that substrate needs periodic, structured
review for staleness, contradictions, dead references, and bloat. MEMORY.md in particular can
outgrow the context budget and stop loading in full — this audit surfaces that kind of drift.

The fan-out logic lives in `substrate_audit_workflow.js`; this skill runs it and handles the
human-in-the-loop report + approval.

## When to invoke
**Invoke when** the user types `/aacc-substrate-audit` or asks to audit/clean/prune memory,
MEMORY.md, CLAUDE.md, docs, or "find stale/contradictory entries."

**Skip when** they want to edit one known file, read one memory, or write a new memory.

## How to run

1. **Run from the root of the project whose substrate you want audited** — the workflow reads
   repo-relative paths (CLAUDE.md, docs/, tasks/). If the cwd is elsewhere, `cd` there or tell
   the user.
2. **Run the workflow.** Invoke the `Workflow` tool with:
   `{ scriptPath: "<repo>/.claude/skills/aacc-substrate-audit/substrate_audit_workflow.js" }`
   Optionally pass `args` to narrow scope (e.g. `args: { focus: "memory" }`) — default audits all stores.
3. **Write the report.** The workflow returns `{ summary, report_markdown, top_actions }`.
   Get today's date (`date +%F`) and write `report_markdown` to:
   `./audits/substrate_audit_<YYYY-MM-DD>.md`
   (create the `audits/` folder in the current directory if it is missing).
4. **Present `top_actions`** to the user as a short list.

## Read-only contract (important)
- The workflow and this skill **never edit the substrate** — they only produce a report.
- Applying any prune/merge/fix is a **separate step the user must approve.** After they approve
  specific items, apply them one at a time (Edit MEMORY.md, delete a stale memory, convert a
  copy to a pointer, etc.), respecting the memory rules (one fact per file, MEMORY.md = index).
- Never delete a memory you didn't write or that contradicts how it was described — surface it.

## Cost / cadence
- Reader agents run on Sonnet, the existence-checker on Haiku, synthesis on Opus (model
  tiering). A full run is a medium fan-out (~8–12 agents), not a swarm.
- Good as a manual monthly pass, or put the whole skill on `/loop` once it's proven.
