// Runs the REAL substrate_audit_workflow.js with stubbed Workflow globals (agent, parallel, phase,
// log, args), so the control flow is tested exactly as written, with no model calls.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../substrate_audit_workflow.js', import.meta.url)), 'utf8')
  .replace('export const meta', 'const meta');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export async function runWorkflow(args, respond) {
  const calls = [];
  const logs = [];
  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts });
    return respond(opts.label, prompt, opts);
  };
  // Like the real parallel(): a thunk that throws resolves to null; the call never rejects.
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', SRC);
  const result = await fn(args, agent, parallel, () => {}, (m) => logs.push(m));
  return { result, calls, logs };
}

export const MEM = '/srv/acme/.claude/projects/-srv-acme-app/memory';
export const memFile = (n) => `${MEM}/feedback-note-${n}.md`;

export const manifest = (over = {}) => ({
  home: '/srv/acme',
  project_root: '/srv/acme/app',
  memory_dir: MEM,
  memory_files: [`${MEM}/MEMORY.md`, ...Array.from({ length: 6 }, (_, i) => memFile(i + 1))],
  claude_md: '/srv/acme/app/CLAUDE.md',
  docs_session: ['/srv/acme/app/docs/SESSION-NOTES.md'],
  tasks_open: ['/srv/acme/app/tasks/billing.md'],
  project_docs: [],
  ...over,
});
export const READER = {
  referenced_paths: ['docs/old-runbook.md'],
  contradictions: [{ detail: 'retention is 30 days vs 90 days', files: ['a.md', 'b.md'] }],
  stale_candidates: [],
  copy_not_pointer: [],
  bloat_candidates: [],
};
export const DEAD = { dead: [{ path: 'docs/old-runbook.md', referenced_by: 'MEMORY.md' }] };
export const SYNTH = { summary: 'Two contradictions.', top_actions: ['fix retention'], report_markdown: '# Substrate audit\n\n## Summary\nok' };

export const happy = (over = {}) => (label) =>
  label === 'manifest' ? manifest(over) : label === 'dead-refs' ? DEAD : label === 'synthesize' ? SYNTH : READER;
