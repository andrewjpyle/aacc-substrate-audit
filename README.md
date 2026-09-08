# aacc-substrate-audit

A read-only **knowledge-substrate drift audit** for Claude Code projects, packaged as a Claude
Code skill and run as a Workflow. It fans out reader agents across your project's knowledge
substrate, then synthesizes a single prioritized prune/merge proposal. It **proposes only** — it
writes an audit report to disk and never edits your substrate.

## What it audits

Over time a Claude Code project accumulates a "knowledge substrate" — the files that tell Claude
how the project works and what is true about it:

- **Claude Code auto-memory** — the per-project `memory/*.md` files, including `MEMORY.md`
- **CLAUDE.md** — the repo's instructions file
- **Project docs** — architecture / design / strategy notes under `docs/`
- **Session notes** — running-log / hand-off docs
- **Open task and spec files** — `tasks/*.md`, `specs/*.md`, and similar

That substrate drifts. Files get renamed but references don't. Two places claim different things.
Work ships but stays marked "in progress." A fact gets copied into three files instead of pointed
to from one. `MEMORY.md` grows past the point where it loads in full. None of this is visible from
inside a single session — which is why it needs a periodic, structured pass.

## What it finds

The synthesis produces a prioritized report with these sections:

- **Dead references** — file paths / dirs / globs mentioned in the substrate that no longer exist
- **Contradictions** — two statements that conflict
- **Stale / shipped-but-marked-open** — claims that look outdated
- **Copy-not-pointer duplication** — the same fact written out in full in more than one place
- **MEMORY.md bloat** — index lines carrying detail that should graduate to a topic file

The governing model is a **pointer-not-copy rule**: each fact has one system-of-record; every
other place points to it. `MEMORY.md` should be a thin index (one line per memory), with detail
living in per-topic files.

## How it works

The workflow (`substrate_audit_workflow.js`) runs four phases:

1. **Manifest** — a Haiku agent discovers every substrate file across the stores.
2. **Scan** — Sonnet reader agents fan out over the files in parallel and flag contradictions,
   staleness, copy-not-pointer duplication, and bloat. Each reader also reports **every** path it
   sees referenced.
3. **Verify refs** — a Haiku agent checks, on disk, which of those referenced paths no longer
   exist (dead references).
4. **Synthesize** — an Opus agent merges all findings into one prioritized proposal plus a short
   list of top actions.

Model tiering keeps cost sane: cheap models for discovery and existence-checking, the strongest
model only for the final synthesis. A full run is a medium fan-out (~8–12 agents), not a swarm.

## Requirements

- **Claude Code** with the **Workflow** tool available (this skill dispatches its fan-out through
  a Workflow script).
- The skill's `allowed-tools` are `Bash`, `Read`, `Write`, `Grep`, `Glob`, `Workflow`.

## Install

Drop the skill folder into your project's skills directory:

```
.claude/skills/aacc-substrate-audit/
├── SKILL.md
├── substrate_audit_workflow.js
├── README.md
└── LICENSE
```

(It also works as a personal skill under `~/.claude/skills/`.)

## Run

From the root of the project whose substrate you want audited:

```
/aacc-substrate-audit
```

The audit report is written to `./audits/substrate_audit_<YYYY-MM-DD>.md` in the current
directory (the `audits/` folder is created if missing), and the top actions are shown inline.

## Read-only, propose-only contract

The workflow and skill **never edit your substrate.** They only produce a report. Applying any
prune, merge, or fix is a separate step you approve, item by item. When you do apply changes,
respect the memory conventions: one fact per file, `MEMORY.md` as the index, and convert copies
into pointers rather than deleting the fact.

## License

MIT. See [LICENSE](LICENSE).
