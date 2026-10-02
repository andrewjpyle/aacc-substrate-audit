export const meta = {
  name: 'aacc-substrate-audit',
  description: 'Read-only drift audit of your project knowledge substrate (Claude Code auto-memory, CLAUDE.md, docs, tasks). Fan-out readers, a dead-reference check, then one prioritized prune/merge proposal.',
  phases: [
    { title: 'Manifest', detail: 'list every substrate file; memory comes from the exact project path only' },
    { title: 'Scan', detail: 'fan-out readers flag contradictions, staleness, copies and bloat' },
    { title: 'Verify refs', detail: 'check which referenced paths no longer exist on disk' },
    { title: 'Synthesize', detail: 'Opus merges findings into a prioritized proposal' },
  ],
}

// ---- constants ---------------------------------------------------------------
// Claude Code stores a project's auto-memory at <config dir>/projects/<project>/memory. <config dir>
// is $CLAUDE_CONFIG_DIR or ~/.claude. <project> is the project root (the main checkout of the git
// repository, so worktrees and subdirectories share it; the cwd outside git) with every
// non-alphanumeric character replaced by "-". Computing it exactly, instead of listing every
// project's memory and picking a likely match, means the audit can never read another project's memory.
const MEMORY_DIR_COMMAND = [
  'R="$(git worktree list --porcelain 2>/dev/null | sed -n \'1s/^worktree //p\')"; [ -n "$R" ] || R="$(pwd)";',
  'D="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$(printf %s "$R" | sed \'s/[^A-Za-z0-9]/-/g\')/memory";',
  '[ -d "$D" ] && echo "$D"',
].join(' ')
// What a discovered memory dir must look like. Anything else is discarded.
const MEMORY_DIR_SHAPE = /\/projects\/-[A-Za-z0-9-]+\/memory$/
const FOCUS_VALUES = ['all', 'memory']
const MEMORY_FILES_PER_READER = 5
// Every agent runs as the read-only Explore type: it has no Edit, Write or NotebookEdit tool, so
// "proposes only" is enforced by the tool set, not just asked for in a prompt.
const READ_ONLY_AGENT = 'Explore'

// ---- schemas -------------------------------------------------------------------
const MANIFEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    home: { type: 'string', description: 'the value of $HOME' },
    project_root: { type: 'string', description: 'the absolute current working directory (pwd)' },
    memory_dir: { type: 'string', description: 'the absolute memory dir printed by the exact-path command (or the given override), or "" if none' },
    memory_files: { type: 'array', items: { type: 'string' }, description: 'absolute paths of the *.md files directly inside memory_dir (incl. MEMORY.md)' },
    claude_md: { type: 'string', description: 'absolute path to ./CLAUDE.md, or "" if not found' },
    docs_session: { type: 'array', items: { type: 'string' }, description: 'project session notes / running-log docs if present' },
    tasks_open: { type: 'array', items: { type: 'string' }, description: 'open task / spec files' },
    project_docs: { type: 'array', items: { type: 'string' }, description: 'other project docs (architecture / design / strategy notes) under docs/' },
  },
  required: ['home', 'project_root', 'memory_dir', 'memory_files', 'claude_md', 'docs_session', 'tasks_open', 'project_docs'],
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

// ---- helpers -------------------------------------------------------------------
function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function list(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []
}

function readerPrompt(files, allFiles) {
  const others = allFiles.filter((f) => !files.includes(f))
  return [
    'You are auditing a project knowledge substrate for DRIFT. Read each of these files IN FULL:',
    files.map((f) => '- ' + f).join('\n'),
    '',
    'The rest of the substrate (Grep these to check whether a fact in YOUR files is contradicted or copied elsewhere;',
    'you do not need to read them in full):',
    others.length ? others.map((f) => '- ' + f).join('\n') : '- (none)',
    '',
    'The substrate must obey: each fact has ONE canonical home (a single system-of-record); other stores hold POINTERS, not copies;',
    "entries should be current (no 'open/in-progress' for work that has shipped); MEMORY.md should be a thin",
    'INDEX (one line per memory) with detail living in topic files.',
    '',
    'Report via the schema:',
    '- referenced_paths: EVERY file path, directory, or glob your files mention (so existence can be verified later). Copy them exactly as written (keep ~ / relative form).',
    '- contradictions: places two statements conflict (detail + the files involved), including conflicts with the other substrate files.',
    '- stale_candidates: claims that look outdated or shipped-but-marked-open (detail + source file).',
    '- copy_not_pointer: the same fact written out in full in more than one place (should be a pointer).',
    '- bloat_candidates: MEMORY.md index lines that are too long or carry detail that should move to a topic file.',
    '',
    'This is READ-ONLY. Do not create, edit, move or delete any file. Be specific and CONSERVATIVE: only report',
    'real, defensible issues. Empty arrays are fine.',
  ].join('\n')
}

function deadRefPrompt(refs, memDir) {
  return [
    'Determine which of these paths referenced by the knowledge substrate DO NOT EXIST on disk.',
    'Use bash: `test -e`, `ls`. Resolve ~ and $HOME. The current working directory is the project root',
    '(so repo-relative paths like CLAUDE.md, docs/..., tasks/... resolve there). A bare memory file name like',
    '`feedback_x.md` resolves inside the memory dir. For a glob, treat it as dead ONLY if nothing matches.',
    'For a path that exists, do not report it. Read-only: never create a missing path.',
    memDir ? 'For each dead path, best-effort grep the memory dir (' + memDir + ') to note which file references it.' : '',
    '',
    'PATHS:',
    refs.map((p) => '- ' + p).join('\n'),
  ].join('\n')
}

function synthPrompt(findings, dead, coverageNotes) {
  return [
    'You are the synthesizer for a knowledge-substrate audit. Below are findings from reader agents and a',
    'dead-reference check. Produce a PRIORITIZED prune/merge proposal. This is READ-ONLY: you PROPOSE; nothing is',
    'applied. Be precise and conservative: every item must name the file and the exact change.',
    '',
    'COVERAGE (what was and was not audited; never call an unaudited store clean):',
    coverageNotes.map((n) => '- ' + n).join('\n'),
    '',
    'SCAN FINDINGS (JSON, one entry per reader group):',
    JSON.stringify(findings),
    '',
    'DEAD REFERENCES (JSON, or null if the check did not run):',
    JSON.stringify(dead),
    '',
    'Write project files relative to the project root and the home directory as ~.',
    'Return via schema. `report_markdown` must be a complete report with these sections (say "none found" where',
    'empty, and "not checked" where coverage says a check did not run): Summary · Dead references to fix ·',
    'Contradictions to resolve · Stale/shipped to unflag · Copy-not-pointer to convert · MEMORY.md bloat to graduate',
    'to topic files. Order every list by impact. `top_actions` = the few highest-impact items, most important first.',
  ].join('\n')
}

function coverageBlock(c) {
  const lines = ['## Coverage', '']
  lines.push('- Memory dir: ' + (c.memory_dir || 'none found at the exact project path (memory NOT audited)'))
  lines.push(`- Files: ${c.memory_files} memory, ${c.claude_md ? 1 : 0} CLAUDE.md, ${c.docs_session} session docs, ${c.tasks_open} task/spec files, ${c.project_docs} project docs`)
  lines.push(`- Reader groups: ${c.readers_ok} of ${c.readers_total} completed`)
  for (const f of c.readers_failed) lines.push(`- NOT AUDITED (reader "${f.label}" failed): ${f.files.join(', ')}`)
  lines.push('- Dead-reference check: ' + c.deadref)
  if (c.ignored_memory_paths) lines.push(`- Ignored ${c.ignored_memory_paths} path(s) the manifest returned outside the project memory dir`)
  if (c.focus !== 'all') lines.push(`- Focus: ${c.focus} (other stores skipped on purpose)`)
  lines.push('- Nothing was edited. Every item below is a proposal.')
  return lines.join('\n')
}

// ---- args ----------------------------------------------------------------------
let input = args
if (typeof input === 'string') {
  try { input = JSON.parse(input) } catch (e) { input = { focus: input } }
}
input = input || {}
const focus = input.focus || 'all'
if (!FOCUS_VALUES.includes(focus)) throw new Error(`Unknown focus "${focus}". Use one of: ${FOCUS_VALUES.join(', ')}.`)
// An explicit memory dir, for setups the exact-path rule cannot see (autoMemoryDirectory,
// CLAUDE_CODE_PROJECT_DIR_NAME). It is used as given and never guessed.
const memoryOverride = typeof input.memory_dir === 'string' ? input.memory_dir.trim() : ''
if (memoryOverride && !/^(\/|~\/)/.test(memoryOverride)) throw new Error(`memory_dir must be an absolute path or start with ~/ (got "${memoryOverride}").`)

// ---- run -----------------------------------------------------------------------
phase('Manifest')
const manifest = await agent(
  [
    'Discover the project knowledge-substrate files and return their paths. Use bash. Read-only: create nothing.',
    '0. home: the value of $HOME. project_root: the output of `pwd`.',
    ...(memoryOverride
      ? ['1. memory_dir: the user named it explicitly. Expand a leading ~ to $HOME and use exactly this dir:',
        '     ' + memoryOverride,
        '   If it does not exist, memory_dir is "" and memory_files is [].']
      : ['1. memory_dir: run EXACTLY this command from the current working directory:',
        '     ' + MEMORY_DIR_COMMAND,
        '   It prints the one memory dir that belongs to this project, or nothing. Use what it prints, verbatim.',
        '   If it prints nothing, memory_dir is "" and memory_files is [].']),
    '   NEVER list ~/.claude/projects/*, NEVER pick another project\'s memory dir that looks similar, and NEVER',
    '   substitute some other folder named memory.',
    '2. memory_files: every `*.md` file directly inside memory_dir (`ls "$D"/*.md`), MEMORY.md included, any name.',
    '3. claude_md: if `./CLAUDE.md` exists in the cwd (project root), give its absolute path, else "".',
    '4. docs_session: any session-note / running-log markdown that exists (for example `./docs/SESSION*.md`,',
    '   `./docs/NEXT*.md`, `./docs/NOTES*.md`); absolute paths.',
    '5. tasks_open: any open task / spec markdown that exists (for example `./tasks/*.md`, `./specs/*.md`).',
    '6. project_docs: other markdown under `./docs` (architecture / design / strategy notes), excluding docs_session.',
    'Return absolute paths. Empty arrays/strings where nothing is found.',
  ].join('\n'),
  { label: 'manifest', schema: MANIFEST_SCHEMA, model: 'haiku', agentType: READ_ONLY_AGENT }
)
if (!manifest) throw new Error('The manifest agent returned nothing, so the substrate was never listed. Refusing to report it as clean.')

// Keep only memory files that sit directly inside the one project memory dir.
let memDir = (manifest.memory_dir || '').replace(/\/+$/, '')
if (memDir && !memoryOverride && !MEMORY_DIR_SHAPE.test(memDir)) {
  log(`Discarding memory dir "${memDir}": not a Claude Code project memory path`)
  memDir = ''
}
const rawMem = list(manifest.memory_files)
const memFiles = memDir
  ? rawMem.filter((f) => f.startsWith(memDir + '/') && !f.slice(memDir.length + 1).includes('/') && f.endsWith('.md'))
  : []
const ignoredMem = rawMem.length - memFiles.length
if (ignoredMem) log(`Ignored ${ignoredMem} memory path(s) outside ${memDir || 'the project memory dir'}`)

const claudeMd = focus === 'all' && typeof manifest.claude_md === 'string' ? manifest.claude_md : ''
const docsSession = focus === 'all' ? list(manifest.docs_session) : []
const tasksOpen = focus === 'all' ? list(manifest.tasks_open) : []
const projectDocs = focus === 'all' ? list(manifest.project_docs) : []

const allFiles = [...memFiles, claudeMd, ...docsSession, ...tasksOpen, ...projectDocs].filter(Boolean)
if (!memFiles.length && focus === 'memory') {
  throw new Error('No auto-memory found at the exact project path (run from the project root). Refusing to report an empty memory as clean.')
}
if (!allFiles.length) {
  throw new Error('Nothing to audit: no auto-memory at the exact project path and no CLAUDE.md, docs or tasks. Refusing to report an empty substrate as clean.')
}
log(`Substrate: ${memFiles.length} memory files + ${claudeMd ? 1 : 0} CLAUDE.md + ${docsSession.length} session docs + ${tasksOpen.length} task specs + ${projectDocs.length} project docs`)
if (!memFiles.length) log('No auto-memory found at the exact project path; memory is NOT audited (reported as such, not as clean)')

phase('Scan')
const groups = []
chunk(memFiles, MEMORY_FILES_PER_READER).forEach((files, i) => groups.push({ label: `mem-${i + 1}`, files }))
const claudeAndDocs = [claudeMd, ...docsSession].filter(Boolean)
if (claudeAndDocs.length) groups.push({ label: 'claude+docs', files: claudeAndDocs })
if (tasksOpen.length) groups.push({ label: 'tasks', files: tasksOpen })
if (projectDocs.length) groups.push({ label: 'project-docs', files: projectDocs })

const results = await parallel(groups.map((g) => () =>
  agent(readerPrompt(g.files, allFiles), { label: g.label, phase: 'Scan', schema: READER_SCHEMA, model: 'sonnet', agentType: READ_ONLY_AGENT })))
const findings = []
const failed = []
groups.forEach((g, i) => (results[i] ? findings.push({ group: g.label, files: g.files, ...results[i] }) : failed.push(g)))
if (!findings.length) throw new Error(`Every reader agent failed (${groups.length}). Refusing to produce an audit over nothing.`)
if (failed.length) log(`${failed.length} reader agent(s) failed; their files are reported as NOT AUDITED: ${failed.map((g) => g.label).join(', ')}`)

const uniqRefs = Array.from(new Set(findings.flatMap((s) => list(s.referenced_paths))))
log(`Scanned ${findings.length}/${groups.length} groups; ${uniqRefs.length} unique referenced paths to verify`)

phase('Verify refs')
let dead = { dead: [] }
let deadStatus = 'no referenced paths to check'
if (uniqRefs.length) {
  dead = await agent(deadRefPrompt(uniqRefs, memDir), { label: 'dead-refs', schema: DEADREF_SCHEMA, model: 'haiku', agentType: READ_ONLY_AGENT })
  deadStatus = dead ? `checked ${uniqRefs.length} paths, ${list((dead.dead || []).map((d) => d && d.path)).length} dead` : `FAILED; ${uniqRefs.length} paths NOT checked`
  if (!dead) log('The dead-reference agent failed; dead references are NOT checked (reported as such)')
}

const coverage = {
  focus,
  memory_dir: memDir,
  memory_files: memFiles.length,
  claude_md: claudeMd,
  docs_session: docsSession.length,
  tasks_open: tasksOpen.length,
  project_docs: projectDocs.length,
  readers_total: groups.length,
  readers_ok: findings.length,
  readers_failed: failed.map((g) => ({ label: g.label, files: g.files })),
  deadref: deadStatus,
  ignored_memory_paths: ignoredMem,
}
// Reports get shared and committed, so show project files relative to the project root and the
// home directory as ~ (the agents still work with absolute paths).
const home = typeof manifest.home === 'string' ? manifest.home.replace(/\/+$/, '') : ''
const root = typeof manifest.project_root === 'string' ? manifest.project_root.replace(/\/+$/, '') : ''
function display(text) {
  let out = String(text)
  if (root.length > 1) out = out.split(root + '/').join('')
  if (home.length > 1) out = out.split(home + '/').join('~/')
  return out
}
const block = display(coverageBlock(coverage))
const complete = !failed.length && !!dead && !!memFiles.length

phase('Synthesize')
const proposal = await agent(synthPrompt(findings, dead, block.split('\n').slice(2).map((l) => l.replace(/^- /, ''))), {
  label: 'synthesize', schema: SYNTH_SCHEMA, model: 'opus', agentType: READ_ONLY_AGENT,
})
if (!proposal) throw new Error('The synthesis agent returned nothing. Refusing to return an empty result that reads as a clean audit.')

// The coverage block is written by this script, not the model, so a partial run can never read as
// complete. It goes right under the report's title (or first, if the report has no title).
const body = display(proposal.report_markdown || '')
const title = body.match(/^# [^\n]*\n/)
const report = title ? title[0] + '\n' + block + '\n\n' + body.slice(title[0].length).replace(/^\n+/, '') : block + '\n\n' + body
return {
  summary: (complete ? '' : 'INCOMPLETE AUDIT (see Coverage). ') + display(proposal.summary || ''),
  top_actions: list(proposal.top_actions).map(display),
  report_markdown: report,
  coverage,
}
