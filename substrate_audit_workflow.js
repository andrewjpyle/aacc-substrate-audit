export const meta = {
  name: 'aacc-substrate-audit',
  description: 'Read-only drift audit of your project knowledge substrate (Claude Code auto-memory, CLAUDE.md, docs, tasks). Fan-out readers → dead-ref check → synthesized prune/merge proposal.',
  phases: [
    { title: 'Manifest', detail: 'discover every substrate file across the stores' },
    { title: 'Scan', detail: 'fan-out readers flag contradictions / staleness / copies / bloat' },
    { title: 'Verify refs', detail: 'check which referenced paths no longer exist on disk' },
    { title: 'Synthesize', detail: 'Opus merges findings into a prioritized proposal' },
  ],
}

// ---- schemas ---------------------------------------------------------------
const MANIFEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memory_files: { type: 'array', items: { type: 'string' }, description: 'all .md files in the Claude Code auto-memory dir (incl. MEMORY.md)' },
    claude_md: { type: 'string', description: 'absolute path to repo CLAUDE.md, or empty if not found' },
    docs_session: { type: 'array', items: { type: 'string' }, description: 'project session notes / running-log docs if present' },
    tasks_open: { type: 'array', items: { type: 'string' }, description: 'open task / spec files' },
    project_docs: { type: 'array', items: { type: 'string' }, description: 'other project docs (architecture / design / strategy notes) under docs/' },
  },
  required: ['memory_files', 'claude_md', 'docs_session', 'tasks_open', 'project_docs'],
}

const READER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    referenced_paths: { type: 'array', items: { type: 'string' }, description: 'EVERY file path / dir / glob these files mention, as written' },
    contradictions: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { detail: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['detail', 'files'] },
    },
    stale_candidates: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { detail: { type: 'string' }, source: { type: 'string' } }, required: ['detail', 'source'] },
    },
    copy_not_pointer: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { detail: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['detail', 'files'] },
    },
    bloat_candidates: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { entry: { type: 'string' }, reason: { type: 'string' } }, required: ['entry', 'reason'] },
    },
  },
  required: ['referenced_paths', 'contradictions', 'stale_candidates', 'copy_not_pointer', 'bloat_candidates'],
}

const DEADREF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dead: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, referenced_by: { type: 'string' } }, required: ['path'] },
    },
  },
  required: ['dead'],
}

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'one-paragraph headline of substrate health' },
    top_actions: { type: 'array', items: { type: 'string' }, description: 'the highest-impact actions, most important first' },
    report_markdown: { type: 'string', description: 'complete human-readable report to write to disk' },
  },
  required: ['summary', 'top_actions', 'report_markdown'],
}

// ---- helpers ---------------------------------------------------------------
function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function readerPrompt(files) {
  return [
    'You are auditing your project knowledge substrate for DRIFT. Read each of these files IN FULL:',
    files.map((f) => '- ' + f).join('\n'),
    '',
    'The substrate must obey: each fact has ONE canonical home (a single system-of-record); other stores hold POINTERS, not copies;',
    "entries should be current (no 'open/in-progress' for work that has shipped); MEMORY.md should be a thin",
    'INDEX (one line per memory) with detail living in topic files.',
    '',
    'Report via the schema:',
    '- referenced_paths: EVERY file path, directory, or glob these files mention (so existence can be verified later). Copy them exactly as written (keep ~ / relative form).',
    '- contradictions: places two statements conflict (detail + the files involved).',
    '- stale_candidates: claims that look outdated or shipped-but-marked-open (detail + source file).',
    '- copy_not_pointer: the same fact written out in full in more than one place (should be a pointer).',
    '- bloat_candidates: MEMORY.md index lines that are too long or carry detail that should move to a topic file.',
    '',
    'Use Read and Grep. Be specific and CONSERVATIVE — only report real, defensible issues. Empty arrays are fine.',
  ].join('\n')
}

function deadRefPrompt(refs, memDir) {
  return [
    'Determine which of these paths referenced by the knowledge substrate DO NOT EXIST on disk.',
    'Use bash: `test -e`, `ls`. Resolve ~ and $HOME. The current working directory is the project root',
    '(so repo-relative paths like CLAUDE.md, docs/..., tasks/... resolve there). For a glob, treat it as dead',
    'ONLY if nothing matches. For a path that exists, do not report it.',
    'For each dead path, best-effort grep the memory dir (' + memDir + ') to note which file references it.',
    '',
    'PATHS:',
    refs.map((p) => '- ' + p).join('\n'),
  ].join('\n')
}

function synthPrompt(scans, dead) {
  return [
    'You are the synthesizer for a knowledge-substrate audit. Below are findings from reader agents and a',
    'dead-reference check. Produce a PRIORITIZED prune/merge proposal. This is READ-ONLY: you PROPOSE; nothing is',
    'applied. Be precise and conservative — every item must name the file and the exact change.',
    '',
    'SCAN FINDINGS (JSON):',
    JSON.stringify(scans),
    '',
    'DEAD REFERENCES (JSON):',
    JSON.stringify(dead),
    '',
    'Return via schema. `report_markdown` must be a complete report with these sections (say "none found" where',
    'empty): Summary · Dead references to fix · Contradictions to resolve · Stale/shipped to unflag · ',
    'Copy-not-pointer to convert · MEMORY.md bloat to graduate to topic files. Order every list by impact.',
    '`top_actions` = the few highest-impact items, most important first.',
  ].join('\n')
}

// ---- run -------------------------------------------------------------------
phase('Manifest')
const manifest = await agent(
  [
    'Discover the project knowledge-substrate files and return their paths. Use bash. Steps:',
    '1. Auto-memory dir: Claude Code stores per-project auto-memory under `"$HOME"/.claude/projects/<project>/memory`,',
    '   where <project> is derived from the project path. Discover it generically — DO NOT hardcode any project name:',
    '     a. List candidates: `ls -d "$HOME"/.claude/projects/*/memory 2>/dev/null`.',
    '     b. Prefer the candidate whose <project> segment corresponds to the CURRENT working directory. Claude Code',
    '        builds that segment from the cwd path with `/` replaced by `-`; you can compute a hint with',
    '        `printf %s "$PWD" | sed "s#/#-#g"` and match it against the candidate dir names.',
    '     c. Also accept a repo-local `./memory` dir if one exists.',
    '   Then list ALL `*.md` in the chosen dir (includes MEMORY.md).',
    '2. claude_md: if `./CLAUDE.md` exists in the cwd (project root), give its absolute path, else empty string.',
    '3. docs_session: any project session-note / running-log markdown that exists (for example files matching',
    '   `./docs/SESSION*.md`, `./docs/NEXT*.md`, `./docs/NOTES*.md`); include all that exist, absolute paths.',
    '4. tasks_open: any open task / spec markdown that exists (for example `./tasks/*.md`, `./specs/*.md`);',
    '   include all that exist.',
    '5. project_docs: other markdown docs under `./docs` (architecture / design / strategy notes) that exist,',
    '   excluding ones already captured in docs_session.',
    'Return absolute paths. Empty arrays/strings where nothing is found.',
  ].join('\n'),
  { label: 'manifest', schema: MANIFEST_SCHEMA, model: 'haiku' }
)

const memFiles = manifest.memory_files || []
const memDir = memFiles.length ? memFiles[0].replace(/\/[^/]+$/, '') : '$HOME/.claude/projects/<project>/memory'
const memChunks = chunk(memFiles, 5)
log(`Substrate: ${memFiles.length} memory files (${memChunks.length} groups) + CLAUDE.md + ${(manifest.docs_session || []).length} session docs + ${(manifest.tasks_open || []).length} task specs + ${(manifest.project_docs || []).length} project docs`)

phase('Scan')
const readerTasks = []
memChunks.forEach((files, i) => {
  readerTasks.push(() => agent(readerPrompt(files), { label: `mem-${i + 1}`, phase: 'Scan', schema: READER_SCHEMA, model: 'sonnet' }))
})
const claudeAndDocs = [manifest.claude_md, ...(manifest.docs_session || [])].filter(Boolean)
if (claudeAndDocs.length) readerTasks.push(() => agent(readerPrompt(claudeAndDocs), { label: 'claude+docs', phase: 'Scan', schema: READER_SCHEMA, model: 'sonnet' }))
if ((manifest.tasks_open || []).length) readerTasks.push(() => agent(readerPrompt(manifest.tasks_open), { label: 'tasks', phase: 'Scan', schema: READER_SCHEMA, model: 'sonnet' }))
if ((manifest.project_docs || []).length) readerTasks.push(() => agent(readerPrompt(manifest.project_docs), { label: 'project-docs', phase: 'Scan', schema: READER_SCHEMA, model: 'sonnet' }))

const scans = (await parallel(readerTasks)).filter(Boolean)

const allRefs = []
scans.forEach((s) => (s.referenced_paths || []).forEach((p) => allRefs.push(p)))
const uniqRefs = Array.from(new Set(allRefs))
log(`Scanned ${scans.length} groups; ${uniqRefs.length} unique referenced paths to verify`)

phase('Verify refs')
const dead = uniqRefs.length
  ? await agent(deadRefPrompt(uniqRefs, memDir), { label: 'dead-refs', schema: DEADREF_SCHEMA, model: 'haiku' })
  : { dead: [] }

phase('Synthesize')
const proposal = await agent(synthPrompt(scans, dead), { label: 'synthesize', schema: SYNTH_SCHEMA, model: 'opus' })

return proposal
