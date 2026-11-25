// Run: node --test gate-review.test.mjs   (offline; the reviewer is a stub)
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const GATE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gate-review.mjs');

const STUB = `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.STUB_CALLS, 'x');
const mode = process.env.STUB_MODE;
const isCodex = process.argv[2] === 'exec';
if ((mode === 'agy-down' || mode === 'claude-down') && !isCodex) process.exit(1);
if (mode === 'denied') {
  console.error('jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for');
  process.exit(0);
}
const inputsOk = fs.readFileSync('.gate-focus.md', 'utf8').includes('FOCUS-MARK')
  && fs.readFileSync('.gate-diff.patch', 'utf8').includes('a.txt')
  && fs.existsSync('a.txt') && !fs.existsSync('.git');
const findings = mode === 'high'
  ? [{ id: 'R-01', severity: 'high', location: 'a.txt:1', bug: 'b', expected: 'e-mark', fix: 'f', test: 't' }] : [];
const review = { status: 'approved', summary: inputsOk ? 'inputs-ok' : 'inputs-missing', findings };
if (isCodex) {
  fs.writeFileSync(process.argv[process.argv.indexOf('-o') + 1], JSON.stringify(review));
} else {
  console.log('warning: noise before the envelope');
  console.log(JSON.stringify({ result: '\`\`\`json\\n' + JSON.stringify(review) + '\\n\`\`\`' }));
}
`;

function fixture(planBody = '## Task 1 — thing\n- **Review Focus:** FOCUS-MARK must hold.\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'plan.md'), planBody);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  git('commit', '-qam', 'change');
  const stub = path.join(dir, 'stub.cjs');
  fs.writeFileSync(stub, STUB, { mode: 0o755 });
  // Simulates a Claude Code driver whatever agent actually runs this test file.
  const run = (mode, extra = [], env = {}) => spawnSync(process.execPath,
    [GATE, '--plan', 'plan.md', '--base', base, '--out', 'reviews/r.md', ...extra],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '1', ANTIGRAVITY_TRAJECTORY_ID: '', CODEX_THREAD_ID: '', GATE_SAME_VENDOR: '', GATE_CLAUDE_MODEL: '', GATE_AGY_MODEL: '', GATE_CODEX_MODEL: '', GATE_AGY_BIN: stub, GATE_CLAUDE_BIN: stub, GATE_CODEX_BIN: stub, STUB_MODE: mode, STUB_CALLS: path.join(dir, 'calls'), ...env } });
  const calls = () => (fs.existsSync(path.join(dir, 'calls')) ? fs.readFileSync(path.join(dir, 'calls'), 'utf8').length : 0);
  return { dir, run, calls, review: () => fs.readFileSync(path.join(dir, 'reviews/r.md'), 'utf8') };
}

test('approved: bullet-style focus, patch and snapshot reach the reviewer', () => {
  const f = fixture();
  const r = f.run('ok');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /GateStatus: approved\n$/);
  assert.match(f.review(), /^Status: approved$/m);
  assert.match(f.review(), /Summary: inputs-ok/);
  assert.match(f.review(), /^Head-SHA: [0-9a-f]{40}$/m);
  assert.match(f.review(), /^# Gate Review \(agy\)$/m); // Claude driver defaults to the agy reviewer
  assert.match(f.review(), /^Reviewer-Model: gemini-4-carbon-high$/m);
});

test('cross-vendor rule: reviewer is the other vendor, same vendor is refused', () => {
  const f = fixture();
  const agyDriver = { CLAUDECODE: '', ANTIGRAVITY_TRAJECTORY_ID: 't1' };
  assert.match(f.run('ok', [], agyDriver).stdout, /GateStatus: approved\n$/);
  assert.match(f.review(), /^# Gate Review \(claude\)$/m);
  assert.match(f.review(), /^Reviewer-Model: claude-fable-5-2$/m);
  const calls = f.calls();
  assert.equal(f.run('ok', ['--reviewer', 'claude']).status, 2); // Claude driver, Claude reviewer
  assert.equal(f.run('ok', ['--reviewer', 'agy'], agyDriver).status, 2); // agy driver, agy reviewer
  assert.equal(f.run('ok', [], { CLAUDECODE: '' }).status, 2); // unknown driver, no --reviewer
  assert.equal(f.calls(), calls);
});

test('Claude driver: agy cannot review, codex takes over and the review file says so', () => {
  const f = fixture();
  const r = f.run('agy-down');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ReviewerFailed: agy: /m);
  assert.match(r.stdout, /GateStatus: approved\n$/);
  assert.match(f.review(), /^# Gate Review \(codex\)$/m);
  assert.match(f.review(), /^Reviewer-Model: gpt-6\.2-astra$/m);
  assert.match(f.review(), /^Note: fallback reviewer; agy: /m);
  assert.match(f.review(), /Summary: inputs-ok/);
  assert.equal(f.run('agy-down', ['--reviewer', 'agy']).status, 4); // forced reviewer: no fallback
});

test('Antigravity driver: claude cannot review, codex takes over and the review file says so', () => {
  const f = fixture();
  const agyDriver = { CLAUDECODE: '', ANTIGRAVITY_TRAJECTORY_ID: 't1' };
  const r = f.run('claude-down', [], agyDriver);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ReviewerFailed: claude: /m);
  assert.match(r.stdout, /GateStatus: approved\n$/);
  assert.match(f.review(), /^# Gate Review \(codex\)$/m);
  assert.match(f.review(), /^Reviewer-Model: gpt-6\.2-astra$/m);
  assert.match(f.review(), /^Note: fallback reviewer; claude: /m);
  assert.match(f.review(), /Summary: inputs-ok/);
  assert.equal(f.run('claude-down', ['--reviewer', 'claude'], agyDriver).status, 4); // forced reviewer: no fallback
});

test('Codex driver: claude reviews first, agy is the fallback, codex is refused', () => {
  const f = fixture();
  const codexDriver = { CLAUDECODE: '', CODEX_THREAD_ID: 't1' };
  assert.match(f.run('ok', [], codexDriver).stdout, /GateStatus: approved\n$/);
  assert.match(f.review(), /^# Gate Review \(claude\)$/m);
  const r = f.run('ok', [], { ...codexDriver, GATE_CLAUDE_BIN: '/nonexistent/claude' });
  assert.match(r.stdout, /^ReviewerFailed: claude: /m);
  assert.match(f.review(), /^# Gate Review \(agy\)$/m);
  assert.equal(f.run('ok', ['--reviewer', 'codex'], codexDriver).status, 2); // Codex driver, Codex reviewer
  assert.equal(f.run('ok', [], { CODEX_THREAD_ID: 't1' }).status, 2); // two drivers detected = nested, no --reviewer
});

test('GATE_SAME_VENDOR=1, Claude driver, no agy/codex installed: a fresh claude reviewer runs last', () => {
  const f = fixture();
  const missing = { GATE_AGY_BIN: '/nonexistent/agy', GATE_CODEX_BIN: '/nonexistent/codex' };
  const off = f.run('ok', [], missing);
  assert.equal(off.status, 4); // opt-in off: no Claude fallback
  assert.match(off.stdout + off.stderr, /set GATE_SAME_VENDOR=1/);
  const r = f.run('ok', [], { ...missing, GATE_SAME_VENDOR: '1' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ReviewerFailed: agy: /m);
  assert.match(r.stdout, /^ReviewerFailed: codex: /m);
  assert.match(r.stdout, /GateStatus: approved\n$/);
  assert.match(f.review(), /^# Gate Review \(claude\)$/m);
  assert.match(f.review(), /^Reviewer-Model: claude-fable-5-2$/m);
  assert.equal(f.run('ok', ['--reviewer', 'claude'], { GATE_SAME_VENDOR: '1' }).status, 0); // forcing own vendor allowed
});

test('reviewer says approved with a high finding: gate overrides to changes_requested', () => {
  const f = fixture();
  const r = f.run('high');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /GateStatus: changes_requested\n$/);
  assert.match(f.review(), /^Status: changes_requested$/m);
  assert.match(f.review(), /\| R-01 \| high \|/);
  assert.match(f.review(), /^### R-01 \(high\) — `a\.txt:1`\n- Wrong: b\n- Expected: e-mark\n- Fix: f\n- Test: `t`$/m);
});

test('round 2 takes its base from the Head-SHA recorded in the round-1 review', () => {
  const f = fixture();
  f.run('high');
  fs.writeFileSync(path.join(f.dir, 'a.txt'), 'three\n');
  execFileSync('git', ['-C', f.dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'fix']);
  const r = f.run('ok', ['--round', '2']);
  assert.match(r.stdout, /GateStatus: approved\n$/, r.stdout + r.stderr);
  assert.match(f.review(), /^Review-Round: 2$/m);
});

test('permission denied: one retry, then exit 4 with GateStatus: error and no review file', () => {
  const f = fixture();
  const r = f.run('denied', ['--reviewer', 'agy']);
  assert.equal(r.status, 4);
  assert.match(r.stdout, /GateStatus: error\nError: .*"command" permission/);
  assert.equal(f.calls(), 2);
  assert.throws(() => f.review());
});

test('bad input exits 2 before any reviewer call', () => {
  const noFocus = fixture('## Task 1 — thing\nno criteria here\n');
  assert.equal(noFocus.run('ok').status, 2);
  const f = fixture();
  assert.equal(f.run('ok', ['--round', '2']).status, 2); // no round-1 review file
  assert.equal(f.run('ok', ['--risk', 'extreme']).status, 2);
  assert.equal(noFocus.calls() + f.calls(), 0);
});
