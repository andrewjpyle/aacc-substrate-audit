---
name: aacc-substrate-audit
description: |
  Use this skill when the user invokes `/aacc-substrate-audit` (or asks to audit / clean up /
  prune the knowledge substrate, memory, MEMORY.md, CLAUDE.md, or asks "is anything stale or
  contradictory in my memory/docs"). Runs a read-only Workflow that fans out reader agents across
  the project knowledge substrate (Claude Code auto-memory + MEMORY.md, CLAUDE.md, project docs,
  session notes, and open task/spec files), then synthesizes a PRIORITIZED prune/merge proposal:
  dead file references, contradictions, stale/shipped-but-marked-open claims, copy-not-pointer
  duplication, and MEMORY.md bloat.

  It PROPOSES only: it writes one audit report and never edits the substrate. Applying any prune
  is a separate, user-approved step. Governing model: a pointer-not-copy rule, where each fact has
  one system-of-record and other places point to it.

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

# aacc-substrate-audit: knowledge-substrate drift audit

A read-only self-audit of a project's operating substrate. As a project runs, its knowledge
substrate grows: Claude Code auto-memory files + MEMORY.md, CLAUDE.md, project docs, session
notes, and open task/spec files. Past a certain size it needs a periodic, structured review for
staleness, contradictions, dead references, and bloat. Claude Code loads only the first 200 lines
(or 25KB) of MEMORY.md at session start, so a bloated index silently stops loading in full.

The fan-out logic lives in `substrate_audit_workflow.js` next to this file; this skill runs it and
handles the report and the approval step.

## When to invoke
**Invoke when** the user types `/aacc-substrate-audit` or asks to audit/clean/prune memory,
MEMORY.md, CLAUDE.md, docs, or "find stale/contradictory entries."

**Skip when** they want to edit one known file, read one memory, or write a new memory.

## How to run

1. **Run from the root of the project whose substrate you want audited.** The workflow reads
   repo-relative paths (CLAUDE.md, docs/, tasks/) and finds the auto-memory dir by Claude Code's
   exact rule (below). If the cwd is elsewhere, `cd` there or tell the user.
2. **Run the workflow.** Invoke the `Workflow` tool with `scriptPath` set to the absolute path of
   `substrate_audit_workflow.js` in this skill's directory (for example
   `~/.claude/skills/aacc-substrate-audit/substrate_audit_workflow.js`, expanded). Optional `args`:
   - `{ focus: "memory" }` audits only the auto-memory (default `"all"`).
   - `{ memory_dir: "/abs/path" }` names the memory dir explicitly, for setups the exact rule
     cannot see (`autoMemoryDirectory` in settings, or `CLAUDE_CODE_PROJECT_DIR_NAME`).
3. **Write the report.** The workflow returns `{ summary, report_markdown, top_actions, coverage }`.
   Get today's date (`date +%F`) and write `report_markdown` verbatim to
   `./audits/substrate_audit_<YYYY-MM-DD>.md` (create `audits/` if it is missing).
4. **Present** the summary and `top_actions` as a short list. If the summary starts with
   `INCOMPLETE AUDIT`, say so first and name what was not audited (from the report's Coverage block).

## How the memory dir is found
Claude Code keeps auto-memory at `<config dir>/projects/<project>/memory`, where `<config dir>` is
`$CLAUDE_CONFIG_DIR` or `~/.claude`, and `<project>` is the project root (the git repository's main
checkout, so worktrees and subdirectories share it; the cwd outside git) with every non-alphanumeric
character replaced by `-`. The workflow computes exactly that path. It never lists other projects'
memory dirs or picks a similar-looking one, and it discards any memory path outside the one dir.

## Read-only contract (important)
- Every workflow agent runs as the read-only `Explore` type, which has no Edit or Write tool. The
  only file written is the report, by this skill, in step 3.
- Applying any prune/merge/fix is a **separate step the user must approve.** After they approve
  specific items, apply them one at a time (edit MEMORY.md, delete a stale memory, convert a copy
  to a pointer), respecting the memory rules (one fact per file, MEMORY.md = index).
- Never delete a memory you didn't write or that contradicts how it was described: surface it.

## Failure handling
- A failed reader is listed as NOT AUDITED in the Coverage block, never counted as clean.
- No memory found: the audit still covers the other stores and says memory was NOT audited.
  With `focus: "memory"`, or when there is nothing at all to audit, it refuses instead.
- A failed manifest, a failed synthesis, or every reader failing is an error, not an empty result.

## Cost / cadence
- One Haiku manifest agent, one Sonnet reader per 5 memory files plus one each for CLAUDE.md +
  session notes, tasks, and project docs, one Haiku dead-reference checker, one Opus synthesizer.
- Good as a manual monthly pass.
