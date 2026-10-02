import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runWorkflow, happy, MEM, SYNTH } from './harness.mjs';

const labels = (calls) => calls.map((c) => c.opts.label);
const synthPrompt = (calls) => calls.find((c) => c.opts.label === 'synthesize').prompt;

test('runs manifest, one reader per group, dead-refs, then synthesis, with model tiering', async () => {
  const { result, calls } = await runWorkflow(undefined, happy());
  // 7 memory files -> 2 groups of at most 5, plus claude+docs and tasks.
  assert.deepEqual(labels(calls), ['manifest', 'mem-1', 'mem-2', 'claude+docs', 'tasks', 'dead-refs', 'synthesize']);
  const model = (l) => calls.find((c) => c.opts.label === l).opts.model;
  assert.equal(model('manifest'), 'haiku');
  assert.equal(model('mem-1'), 'sonnet');
  assert.equal(model('dead-refs'), 'haiku');
  assert.equal(model('synthesize'), 'opus');
  assert.equal(result.summary, SYNTH.summary);
  assert.deepEqual(result.top_actions, SYNTH.top_actions);
});

test('manifest finds the memory dir by exact path, never by listing other projects', async () => {
  const { calls } = await runWorkflow(undefined, happy());
  const prompt = calls.find((c) => c.opts.label === 'manifest').prompt;
  assert.match(prompt, /sed 's\/\[\^A-Za-z0-9\]\/-\/g'/);
  assert.match(prompt, /NEVER list ~\/\.claude\/projects\/\*/);
  assert.doesNotMatch(prompt, /ls -d "\$HOME"\/\.claude\/projects\/\*\/memory/);
  assert.doesNotMatch(prompt, /\.\/memory/);
});

test('memory files outside the project memory dir are dropped, not audited', async () => {
  const other = '/srv/acme/.claude/projects/-srv-other-app/memory/feedback-secret.md';
  const { calls, logs, result } = await runWorkflow(undefined, happy({ memory_files: [`${MEM}/MEMORY.md`, other] }));
  assert.ok(!calls.some((c) => c.opts.label.startsWith('mem-') && c.prompt.includes('feedback-secret')));
  assert.ok(logs.some((m) => /Ignored 1 memory path/.test(m)));
  assert.equal(result.coverage.ignored_memory_paths, 1);
});

test('a memory dir that is not a Claude Code project memory path is discarded', async () => {
  const { calls, result } = await runWorkflow(undefined, happy({ memory_dir: '/srv/acme/app/memory', memory_files: ['/srv/acme/app/memory/x.md'] }));
  assert.ok(!labels(calls).some((l) => l.startsWith('mem-')));
  assert.equal(result.coverage.memory_dir, '');
  assert.match(result.summary, /^INCOMPLETE AUDIT/);
});

test('reads every memory file whatever its prefix: feedback_, feedback- and others', async () => {
  const files = [`${MEM}/MEMORY.md`, `${MEM}/feedback_a.md`, `${MEM}/feedback-b.md`, `${MEM}/project-c.md`];
  const { calls } = await runWorkflow(undefined, happy({ memory_files: files }));
  const read = calls.filter((c) => c.opts.label.startsWith('mem-')).map((c) => c.prompt).join('\n');
  for (const f of files) assert.ok(read.includes('- ' + f), f);
});

test('each reader is told the rest of the substrate so cross-group contradictions are visible', async () => {
  const { calls } = await runWorkflow(undefined, happy());
  const mem1 = calls.find((c) => c.opts.label === 'mem-1').prompt;
  const rest = mem1.split('The rest of the substrate')[1];
  assert.ok(rest.includes(`${MEM}/feedback-note-6.md`), 'mem-1 should see mem-2 files');
  assert.ok(rest.includes('/srv/acme/app/CLAUDE.md'));
});

test('a failed reader is reported as NOT AUDITED, never counted as clean', async () => {
  const respond = (l) => (l === 'mem-2' ? null : happy()(l));
  const { calls, logs, result } = await runWorkflow(undefined, respond);
  const findings = JSON.parse(synthPrompt(calls).split('\n').find((line) => line.startsWith('[{')));
  assert.equal(findings.length, 3);
  assert.ok(!findings.some((f) => f.group === 'mem-2'));
  assert.ok(logs.some((m) => /1 reader agent\(s\) failed/.test(m)));
  assert.match(result.report_markdown, /NOT AUDITED \(reader "mem-2" failed\)/);
  assert.match(result.summary, /^INCOMPLETE AUDIT/);
});

test('if every reader fails, it refuses to produce an audit', async () => {
  const respond = (l) => (['manifest', 'synthesize', 'dead-refs'].includes(l) ? happy()(l) : null);
  await assert.rejects(runWorkflow(undefined, respond), /Every reader agent failed/);
});

test('a failed manifest is an error, not an empty "clean" audit', async () => {
  await assert.rejects(runWorkflow(undefined, (l) => (l === 'manifest' ? null : happy()(l))), /manifest agent returned nothing/);
});

test('an empty substrate is refused instead of reported as clean', async () => {
  const empty = { memory_dir: '', memory_files: [], claude_md: '', docs_session: [], tasks_open: [], project_docs: [] };
  await assert.rejects(runWorkflow(undefined, happy(empty)), /Nothing to audit/);
});

test('no memory but other docs: runs, and says memory was NOT audited', async () => {
  const { result, logs } = await runWorkflow(undefined, happy({ memory_dir: '', memory_files: [] }));
  assert.match(result.report_markdown, /none found at the exact project path \(memory NOT audited\)/);
  assert.match(result.summary, /^INCOMPLETE AUDIT/);
  assert.ok(logs.some((m) => /memory is NOT audited/.test(m)));
});

test('a failed dead-reference check says "not checked", not "none found"', async () => {
  const { calls, result } = await runWorkflow(undefined, (l) => (l === 'dead-refs' ? null : happy()(l)));
  assert.match(result.report_markdown, /Dead-reference check: FAILED; 1 paths NOT checked/);
  assert.match(synthPrompt(calls), /DEAD REFERENCES \(JSON, or null if the check did not run\):\nnull/);
  assert.match(result.summary, /^INCOMPLETE AUDIT/);
});

test('a complete run has no INCOMPLETE flag and puts Coverage under the title', async () => {
  const { result } = await runWorkflow(undefined, happy());
  assert.doesNotMatch(result.summary, /INCOMPLETE/);
  assert.match(result.report_markdown, /^# Substrate audit\n\n## Coverage\n/);
  assert.match(result.report_markdown, /Reader groups: 4 of 4 completed/);
});

test('a synthesis that returns nothing is an error, not a silent empty result', async () => {
  await assert.rejects(runWorkflow(undefined, (l) => (l === 'synthesize' ? null : happy()(l))), /synthesis agent returned nothing/);
});

test('every agent is the read-only Explore type, so it cannot edit the substrate', async () => {
  const { calls } = await runWorkflow(undefined, happy());
  assert.ok(calls.length > 0);
  for (const c of calls) assert.equal(c.opts.agentType, 'Explore', c.opts.label);
});

test('focus "memory" audits only the memory store; unknown focus values are rejected', async () => {
  const { calls, result } = await runWorkflow({ focus: 'memory' }, happy());
  assert.deepEqual(labels(calls).filter((l) => l !== 'dead-refs'), ['manifest', 'mem-1', 'mem-2', 'synthesize']);
  assert.match(result.report_markdown, /Focus: memory/);
  await assert.rejects(runWorkflow({ focus: 'vault' }, happy()), /Unknown focus "vault"/);
  await assert.rejects(runWorkflow('{"focus":"memory"}', happy({ memory_dir: '', memory_files: [] })), /No auto-memory found/);
});

test('the memory-dir encoding matches Claude Code: every non-alphanumeric becomes "-"', () => {
  const out = execFileSync('sh', ['-c', "printf %s '/opt/a_b/my.project' | sed 's/[^A-Za-z0-9]/-/g'"], { encoding: 'utf8' });
  assert.equal(out, '-opt-a-b-my-project');
});

// The real shell command from the script, run against throwaway dirs (no real ~/.claude is touched).
async function memoryCommand() {
  const { calls } = await runWorkflow(undefined, happy());
  const lines = calls[0].prompt.split('\n');
  return lines[lines.findIndex((l) => /run EXACTLY this command/.test(l)) + 1].trim();
}
function sh(cmd, cwd, env) {
  try {
    return execFileSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } }).trim();
  } catch (e) {
    return (e.stdout || '').trim(); // the command exits 1 when the dir is absent
  }
}
const encode = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

test('the command prints the exact dir outside git, and nothing for a lookalike project', async () => {
  const cmd = await memoryCommand();
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'sa-home-')));
  const proj = realpathSync(mkdtempSync(join(tmpdir(), 'sa_proj.x-')));
  mkdirSync(join(home, '.claude/projects', encode(proj) + '-other/memory'), { recursive: true });
  assert.equal(sh(cmd, proj, { HOME: home }), '', 'a lookalike project dir must not be returned');
  mkdirSync(join(home, '.claude/projects', encode(proj), 'memory'), { recursive: true });
  assert.equal(sh(cmd, proj, { HOME: home }), join(home, '.claude/projects', encode(proj), 'memory'));
});

test('inside git, a subdirectory and a worktree resolve to the main checkout memory, as Claude Code does', async () => {
  const cmd = await memoryCommand();
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'sa-home-')));
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'sa-repo-')));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  mkdirSync(join(repo, 'sub/dir'), { recursive: true });
  const wt = repo + '-wt';
  git('worktree', 'add', '-q', wt);
  const want = join(home, '.claude/projects', encode(repo), 'memory');
  mkdirSync(want, { recursive: true });
  assert.equal(sh(cmd, join(repo, 'sub/dir'), { HOME: home }), want);
  assert.equal(sh(cmd, wt, { HOME: home }), want);
});

test('CLAUDE_CONFIG_DIR replaces ~/.claude as the base', async () => {
  const cmd = await memoryCommand();
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'sa-home-')));
  const cfg = realpathSync(mkdtempSync(join(tmpdir(), 'sa-cfg-')));
  const proj = realpathSync(mkdtempSync(join(tmpdir(), 'sa-proj-')));
  mkdirSync(join(cfg, 'projects', encode(proj), 'memory'), { recursive: true });
  assert.equal(sh(cmd, proj, { HOME: home, CLAUDE_CONFIG_DIR: cfg }), join(cfg, 'projects', encode(proj), 'memory'));
});

test('an explicit memory_dir is used as given, and a relative one is rejected', async () => {
  const custom = '/srv/acme/custom-memory';
  const { calls, result } = await runWorkflow({ memory_dir: custom }, happy({ memory_dir: custom, memory_files: [`${custom}/MEMORY.md`] }));
  assert.match(calls[0].prompt, /use exactly this dir:\n\s+\/srv\/acme\/custom-memory/);
  assert.doesNotMatch(calls[0].prompt, /run EXACTLY this command/);
  assert.equal(result.coverage.memory_dir, custom);
  await assert.rejects(runWorkflow({ memory_dir: 'memory' }, happy()), /memory_dir must be an absolute path/);
});

test('the report shows project files relative to the root and the home dir as ~', async () => {
  const synth = { summary: 'see /srv/acme/app/CLAUDE.md', top_actions: ['edit /srv/acme/app/docs/x.md'], report_markdown: '# A\n\nfix /srv/acme/app/CLAUDE.md' };
  const { result } = await runWorkflow(undefined, (l) => (l === 'synthesize' ? synth : happy()(l)));
  assert.match(result.report_markdown, /Memory dir: ~\/\.claude\/projects\/-srv-acme-app\/memory/);
  assert.match(result.report_markdown, /fix CLAUDE\.md/);
  assert.equal(result.summary, 'see CLAUDE.md');
  assert.deepEqual(result.top_actions, ['edit docs/x.md']);
  assert.doesNotMatch(result.report_markdown, /\/srv\/acme\//);
});
