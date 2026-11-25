#!/usr/bin/env node
// Cross-vendor 2nd-gate reviewer (Claude <-> Antigravity). Zero dependencies, Node >= 20.
// The reviewer runs headless and read-only inside a throwaway export of HEAD (no .git),
// so nothing it does can touch the real repository.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HELP = `gate-review.mjs — headless, read-only cross-vendor 2nd-gate review

Usage:
  node gate-review.mjs --plan <plan.md> --base <rev> --out <review.md> [--reviewer claude|agy|codex]
      [--head <rev>=HEAD] [--round 1|2] [--r1-sha <rev>] [--risk standard|high]
      [--constraints <file>] [--repo <dir>] [--id-prefix R] [--timeout-min 30]

Cross-vendor rule: the agent that drives the release never reviews its own work.
  Driver Claude Code (env CLAUDECODE)                 -> agy; if agy cannot review -> codex
  Driver Antigravity (env ANTIGRAVITY_TRAJECTORY_ID)  -> claude; if claude cannot review -> codex
  Omit --reviewer to get this chain. A fallback is automatic, printed as "ReviewerFailed:"
  and noted in the review file. --reviewer X forces exactly X with no fallback; naming the
  driver's own vendor exits 2.
  GATE_SAME_VENDOR=1 (teams with only one vendor): the driver's own vendor, in a fresh
  headless read-only session, is added as the last fallback and may be forced with --reviewer.

Inputs:
  --plan         Plan file. Needs at least one "Global Constraints" or "Review Focus"
                 heading or bullet ("- **Review Focus:** ..."); only those parts are sent.
  --base/--head  Round 1 reviews the diff base..head.
  --round 2      Delta-only: reviews <r1>..head against the open IDs in the existing --out
                 file. <r1> is --r1-sha, else the Head-SHA recorded in that file.
                 Repeatable: each run reviews the delta since the previous review.
  --risk high    Higher Claude reasoning effort on round 1 (auth, crypto, authorization, concurrency).
  --constraints  Repo rule file (AGENTS.md, CLAUDE.md, ...) given to the reviewer as binding.

Review file: every finding has ID, severity, Where (path:line), Wrong, Expected, Fix, Test.

Result = the last "GateStatus:" line on stdout. Nothing else is a result.
  GateStatus: approved            exit 0  review file written; 0 critical/high/medium.
  GateStatus: changes_requested   exit 0  review file written; fix every open finding.
  GateStatus: error               exit >0 NO review written; an "Error:" line says why.
Exit codes: 0 review written | 2 bad arguments or plan | 3 git precondition | 4 reviewer failed.

Caller rules:
  - approved is computed here: the reviewer said approved AND no critical/high/medium finding.
  - On error: report the Error line verbatim and stop. Do not edit this script, do not
    switch reviewer, do not add permission-bypass flags.
  - A review can take 5-25 minutes. Give the command a long timeout or run it in the
    background and wait; never poll.
  - Raw reviewer output and stderr: <repo>/.superpowers/gate/<review-name>.r<round>.<reviewer>.*

Reviewer models (pinned, written to the review file as "Reviewer-Model:"):
  agy    gemini-4-carbon-high   override: GATE_AGY_MODEL
  codex  gpt-6.2-astra          override: GATE_CODEX_MODEL
  claude claude-fable-5-2       override: GATE_CLAUDE_MODEL

Environment: GATE_CLAUDE_BIN, GATE_AGY_BIN, GATE_CODEX_BIN override the reviewer binary.
`;

const EXIT = { usage: 2, git: 3, reviewer: 4 };
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const MISSING = 'NOT GIVEN BY REVIEWER';
// Left out of the patch body (still listed in the stat): pure noise for a reviewer.
const NOISE = [
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'uv.lock', 'poetry.lock',
  'Cargo.lock', 'go.sum', '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.pdf',
  '*.woff', '*.woff2',
].map((f) => `:(exclude,glob)**/${f}`);

// Cross-vendor rule: the agent that drives the release never reviews its own work.
// Reviewers per driver, in order; a later one runs only when the earlier one cannot review.
// GATE_SAME_VENDOR=1 (Claude-only teams): the driver's own vendor, as a fresh headless session, becomes the last fallback.
const SAME_VENDOR = process.env.GATE_SAME_VENDOR === '1';
const CHAIN = { claude: ['agy', 'codex', ...(SAME_VENDOR ? ['claude'] : [])], agy: ['claude', 'codex', ...(SAME_VENDOR ? ['agy'] : [])] };
// Pinned so the review never silently runs on whatever the CLI's default happens to be.
const CLAUDE_MODEL = process.env.GATE_CLAUDE_MODEL || 'claude-fable-5-2';
const AGY_MODEL = process.env.GATE_AGY_MODEL || 'gemini-4-carbon-high';
const CODEX_MODEL = process.env.GATE_CODEX_MODEL || 'gpt-6.2-astra';
const inClaude = Boolean(process.env.CLAUDECODE);
const inAgy = Boolean(process.env.ANTIGRAVITY_TRAJECTORY_ID);
const DRIVER = inClaude === inAgy ? '' : inClaude ? 'claude' : 'agy'; // '' = unknown or nested

let tmpDir = '';
let child = null;
process.on('exit', () => {
  child?.kill('SIGKILL');
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));

// Async spawn (not spawnSync) so the signal handlers above can kill the reviewer and clean up.
function runReviewer(bin, args, cwd, rawPath, errPath, timeoutMs) {
  return new Promise((resolve) => {
    const fds = [fs.openSync(rawPath, 'w'), fs.openSync(errPath, 'w')];
    let timedOut = false;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fds.forEach((fd) => fs.closeSync(fd));
      child = null;
      resolve({ timedOut, ...result });
    };
    child = spawn(bin, args, { cwd, stdio: ['ignore', ...fds] });
    const timer = setTimeout(() => { timedOut = true; child?.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (error) => settle({ error }));
    child.on('close', (status) => settle({ status }));
  });
}

function fail(code, message, logPath) {
  console.log('GateStatus: error');
  console.log(`Error: ${String(message).replace(/\s+/g, ' ').trim()}`);
  if (logPath) console.log(`Log: ${logPath}`);
  process.exit(code);
}

function parseCli() {
  let values;
  try {
    ({ values } = parseArgs({
      strict: true,
      allowPositionals: false,
      options: {
        reviewer: { type: 'string' }, plan: { type: 'string' }, base: { type: 'string' },
        head: { type: 'string', default: 'HEAD' }, out: { type: 'string' },
        repo: { type: 'string' }, round: { type: 'string', default: '1' },
        'r1-sha': { type: 'string' }, risk: { type: 'string', default: 'standard' },
        constraints: { type: 'string' }, 'id-prefix': { type: 'string', default: 'R' },
        'timeout-min': { type: 'string', default: '30' }, help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (e) {
    fail(EXIT.usage, `${e.message} (run with --help)`);
  }
  if (values.help) { process.stdout.write(HELP); process.exit(0); }
  const reviewers = values.reviewer ? [values.reviewer] : CHAIN[DRIVER];
  if (!reviewers) fail(EXIT.usage, 'cannot detect the driving agent; pass --reviewer claude|agy|codex (a vendor that did NOT write the code)');
  if (values.reviewer === DRIVER && !SAME_VENDOR) fail(EXIT.usage, `driver is ${DRIVER}; the 2nd gate must be another vendor: ${CHAIN[DRIVER].join(', then ')}`);
  for (const k of ['plan', 'base', 'out']) {
    if (!values[k]) fail(EXIT.usage, `missing --${k} (run with --help)`);
  }
  const oneOf = (k, allowed) => allowed.includes(values[k])
    || fail(EXIT.usage, `bad --${k} "${values[k]}"; allowed: ${allowed.join('|')}`);
  if (values.reviewer) oneOf('reviewer', ['claude', 'agy', 'codex']);
  oneOf('round', ['1', '2']);
  oneOf('risk', ['standard', 'high']);
  const timeoutMin = Number(values['timeout-min']);
  if (!(timeoutMin > 0)) fail(EXIT.usage, `bad --timeout-min "${values['timeout-min']}"`);
  return { ...values, timeoutMin, reviewers };
}

// Keeps only the review criteria: sections headed "Global Constraints" / "Review Focus"
// (any heading level) and bullets labelled that way, each bullet under its task heading.
function sliceFocus(markdown) {
  const KEY = /(Global Constraints|Review Focus)/i;
  const LABEL = /^\s*(?:[-*+]|\d+\.)?\s*[*_]*\s*(?:Global Constraints|Review Focus)/i;
  const out = [];
  let keepLevel = 0;
  let inBullet = false;
  let lastHeading = '';
  let shownHeading = '';
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      inBullet = false;
      if (KEY.test(heading[2])) { keepLevel = level; out.push(line); continue; }
      if (keepLevel && level <= keepLevel) keepLevel = 0;
      if (keepLevel) out.push(line); else lastHeading = line;
      continue;
    }
    if (keepLevel) {
      if (/^---\s*$/.test(line)) keepLevel = 0; else out.push(line);
      continue;
    }
    if (LABEL.test(line)) {
      if (lastHeading && lastHeading !== shownHeading) { out.push('', lastHeading); shownHeading = lastHeading; }
      out.push(line);
      inBullet = true;
      continue;
    }
    if (inBullet && /^\s+\S/.test(line)) out.push(line); else inBullet = false;
  }
  return out.join('\n').trim();
}

// Finds the {status, findings} object anywhere in the reviewer output, whatever the envelope.
function findPayload(value, depth = 0) {
  if (value == null || depth > 8) return null;
  if (typeof value === 'string') {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return findPayload(JSON.parse(value.slice(start, end + 1)), depth + 1); } catch { /* not one JSON value */ }
    if (depth === 0) {
      for (const line of value.split('\n').reverse()) {
        const found = line.includes('{') ? findPayload(line, 1) : null;
        if (found) return found;
      }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of [...value].reverse()) {
      const found = findPayload(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    if (typeof value.status === 'string' && Array.isArray(value.findings)) return value;
    for (const item of Object.values(value)) {
      const found = findPayload(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function resolveBin(name, envVar) {
  if (process.env[envVar]) return process.env[envVar];
  const local = path.join(os.homedir(), '.local', 'bin', name);
  return fs.existsSync(local) ? local : name;
}

async function main() {
  const opt = parseCli();
  const round = Number(opt.round);

  const top = spawnSync('git', ['-C', opt.repo || '.', 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0) fail(EXIT.git, `not a git repository: ${opt.repo || process.cwd()}`);
  const repo = top.stdout.trim();
  const git = (args, extra = {}) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...extra });
  const sha = (rev, flag) => {
    const r = git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    if (r.status !== 0) fail(EXIT.git, `${flag} "${rev}" is not a commit`);
    return r.stdout.trim();
  };

  const planPath = path.resolve(opt.plan);
  const outPath = path.resolve(opt.out);
  if (!fs.existsSync(planPath)) fail(EXIT.usage, `plan not found: ${planPath}`);
  const focus = sliceFocus(fs.readFileSync(planPath, 'utf8'));
  if (!focus) fail(EXIT.usage, `plan has no "Global Constraints" or "Review Focus" heading or bullet: ${planPath}`);
  if (opt.constraints && !fs.existsSync(opt.constraints)) fail(EXIT.usage, `constraints file not found: ${opt.constraints}`);

  const baseSha = sha(opt.base, '--base');
  const headSha = sha(opt.head, '--head');
  let diffBase = baseSha;
  if (round === 2) {
    if (!fs.existsSync(outPath)) fail(EXIT.usage, `--round 2 needs the round-1 review file at --out: ${outPath}`);
    const recorded = /^Head-SHA:\s*([0-9a-f]{7,40})\s*$/m.exec(fs.readFileSync(outPath, 'utf8'));
    const r1 = opt['r1-sha'] || recorded?.[1];
    if (!r1) fail(EXIT.usage, '--round 2 needs --r1-sha (no Head-SHA line in the round-1 review file)');
    diffBase = sha(r1, '--r1-sha');
  }
  if (git(['merge-base', '--is-ancestor', diffBase, headSha]).status !== 0) {
    fail(EXIT.git, `head ${headSha.slice(0, 7)} is not a descendant of ${diffBase.slice(0, 7)}`);
  }
  const range = `${diffBase}..${headSha}`;
  if (git(['diff', '--quiet', range]).status === 0) fail(EXIT.git, `no changes in ${diffBase.slice(0, 7)}..${headSha.slice(0, 7)}`);

  // Throwaway snapshot of head: plain files, no .git.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-review-'));
  const src = path.join(tmpDir, 'src');
  fs.mkdirSync(src);
  const tar = path.join(tmpDir, 'src.tar');
  if (git(['archive', '--format=tar', '-o', tar, headSha]).status !== 0
    || spawnSync('tar', ['-xf', tar, '-C', src]).status !== 0) {
    fail(EXIT.git, `could not export ${headSha.slice(0, 7)} (git archive + tar)`);
  }
  fs.rmSync(tar);

  fs.writeFileSync(path.join(src, '.gate-focus.md'), `${focus}\n`);
  if (opt.constraints) fs.copyFileSync(opt.constraints, path.join(src, '.gate-constraints.md'));
  if (round === 2) fs.copyFileSync(outPath, path.join(src, '.gate-prev-review.md'));

  const patchFd = fs.openSync(path.join(src, '.gate-diff.patch'), 'w');
  const section = (title, args) => {
    fs.writeSync(patchFd, `${title}\n`);
    if (git(args, { stdio: ['ignore', patchFd, 'pipe'] }).status !== 0) fail(EXIT.git, `git ${args[0]} failed for ${range}`);
    fs.writeSync(patchFd, '\n');
  };
  section(`# Diff ${diffBase.slice(0, 7)}..${headSha.slice(0, 7)} (Round ${round})`, ['log', '--oneline', range]);
  section('# Stat (all files)', ['diff', '--stat', range]);
  section('# Patch (lockfiles and binaries omitted)', ['diff', '-U5', range, '--', '.', ...NOISE]);
  fs.closeSync(patchFd);

  const prefix = opt['id-prefix'];
  const prompt = [
    'Caveman 2nd-gate review (read-only). The current dir is a snapshot of the reviewed commit; it has no .git.',
    '1. Read .gate-focus.md and .gate-diff.patch here (lockfiles and binaries are omitted from the patch).',
    opt.constraints ? '2. .gate-constraints.md holds the repo rules. They are binding review criteria.' : '2. No extra repo rule file was supplied.',
    '3. Verify every Critical/High finding directly in the source files here before reporting it.',
    round === 2
      ? '4. Round 2 DELTA-ONLY: check the open/disputed IDs in .gate-prev-review.md against .gate-diff.patch ONLY. Keep their IDs. Do not invent unrelated scope.'
      : '4. Round 1: audit the full diff against .gate-focus.md. Ignore formatting, praise and trivial nits.',
    "5. Set status='approved' ONLY when 0 critical, 0 high and 0 medium findings remain.",
    `6. Use IDs ${prefix}-01, ${prefix}-02... Every finding states all of: location = WHERE (path:line), bug = WHAT is wrong (1 line, concrete failure), expected = the correct behavior (1 line, observable), fix = HOW (<=4 lines, exact function + change), test = exact name + assertion. Summary <=120 chars. Zero praise.`,
    '7. Tools: read files only. The only shell commands allowed are cat, grep, rg, ls, head, tail, wc. No git, no edits, no network. A denied tool aborts the whole review.',
    '8. Final answer: ONLY the JSON object that matches the schema.',
  ].join('\n');

  const schemaFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gate-review-schema.json');
  if (!fs.existsSync(schemaFile)) fail(EXIT.usage, `missing schema: ${schemaFile}`);

  const logDir = path.join(repo, '.superpowers', 'gate');
  fs.mkdirSync(logDir, { recursive: true });
  const timeoutMs = (opt.timeoutMin + 1) * 60_000;

  // One reviewer, max 2 attempts (the second only after a headless permission denial).
  // Returns { payload } or { error, log }.
  async function review(reviewer) {
    const logBase = path.join(logDir, `${path.basename(outPath, '.md')}.r${round}.${reviewer}`);
    const rawPath = `${logBase}.raw.json`;
    const errPath = `${logBase}.stderr.log`;
    model = { claude: CLAUDE_MODEL, agy: AGY_MODEL, codex: CODEX_MODEL }[reviewer];
    const args = (text) => ({
      claude: ['-p', '--model', CLAUDE_MODEL,
        '--effort', round === 1 && opt.risk === 'high' ? 'high' : 'medium',
        '--permission-mode', 'plan', '--permission-prompts', 'none', '--no-session-persistence',
        '--tools', 'Read,Grep,Glob', '--output-format', 'json',
        '--json-schema', fs.readFileSync(schemaFile, 'utf8'), text],
      // Headless agy auto-denies every tool without an allow-rule. --settings applies to this
      // run only and is never saved: file reads inside the snapshot plus read-only commands.
      agy: ['--model', AGY_MODEL, '--disable-slash-commands',
        '--settings', JSON.stringify({ permissions: { allow: [`read_file(${src})`, ...['cat', 'grep', 'rg', 'ls', 'head', 'tail', 'wc'].map((c) => `command(${c})`)] } }),
        '--output-format', 'json', '--json-schema', schemaFile,
        '--print-timeout', `${opt.timeoutMin}m`, `--print=${text}`],
      // codex prints progress on stdout; its final answer goes to the -o file.
      codex: ['exec', '--model', CODEX_MODEL, '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never',
        '--output-schema', schemaFile, '-o', rawPath, text],
    }[reviewer]);
    const bin = resolveBin(reviewer, `GATE_${reviewer.toUpperCase()}_BIN`);
    let retryNote = '';
    for (let attempt = 1; ; attempt += 1) {
      fs.rmSync(rawPath, { force: true });
      const stdoutPath = reviewer === 'codex' ? `${logBase}.stdout.log` : rawPath;
      const run = await runReviewer(bin, args(prompt + retryNote), src, stdoutPath, errPath, timeoutMs);
      if (run.error?.code === 'ENOENT') return { error: `binary not found: ${bin}` };
      if (run.timedOut) return { error: `no review within ${opt.timeoutMin} min`, log: errPath };
      if (run.error) return { error: `could not start: ${run.error.message}` };

      const raw = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf8') : '';
      const stderr = fs.readFileSync(errPath, 'utf8');
      const payload = findPayload(raw);
      if (payload) return { payload };
      const denied = /required the "([^"]+)" permission/.exec(raw + stderr);
      if (denied && attempt === 1) {
        retryNote = `\n9. A previous attempt was aborted because it used a tool needing the "${denied[1]}" permission. Use only the tools in rule 7.`;
        continue;
      }
      if (denied) return { error: `headless mode denied the "${denied[1]}" permission twice; the operator must allow it`, log: errPath };
      const lastLine = stderr.trim().split('\n').pop() || raw.trim().split('\n').pop() || 'empty output';
      return { error: `no structured review (exit ${run.status}): ${lastLine.slice(0, 300)}`, log: errPath };
    }
  }

  // Reviewer chain: the next one runs only when the previous one could not produce a review.
  let payload = null;
  let reviewer = '';
  let model = '';
  const failures = [];
  for (reviewer of opt.reviewers) {
    const result = await review(reviewer);
    if (result.payload) { payload = result.payload; break; }
    failures.push(`${reviewer}: ${result.error}`);
    console.log(`ReviewerFailed: ${reviewer}: ${result.error}${result.log ? ` (log ${result.log})` : ''}`);
  }
  if (!payload) fail(EXIT.reviewer, failures.join(' | '));

  // Normalise conservatively: never drop a finding, unknown severity counts as blocking.
  const flat = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const findings = payload.findings.map((f, i) => ({
    id: flat(f?.id) || `${prefix}-${String(i + 1).padStart(2, '0')}`,
    severity: SEVERITIES.includes(flat(f?.severity).toLowerCase()) ? flat(f.severity).toLowerCase() : 'medium',
    ...Object.fromEntries(['location', 'bug', 'expected', 'fix', 'test'].map((k) => [k, flat(f?.[k]) || MISSING])),
  }));
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  const blocking = counts.critical + counts.high + counts.medium;
  const status = payload.status === 'approved' && blocking === 0 ? 'approved' : 'changes_requested';
  const summary = flat(payload.summary).slice(0, 140);

  const cell = (s) => s.replace(/\|/g, '\\|');
  const lines = [
    `# Gate Review (${reviewer})`,
    `Status: ${status}`,
    `Reviewer-Model: ${model}`,
    `Review-Round: ${round}`,
    `Base-SHA: ${diffBase}`,
    `Head-SHA: ${headSha}`,
    `Summary: ${summary}`,
  ];
  if (payload.status === 'approved' && status !== 'approved') {
    lines.push(`Note: reviewer said approved with ${blocking} critical/high/medium finding(s); gate overrides to changes_requested.`);
  }
  if (failures.length) lines.push(`Note: fallback reviewer; ${failures.join(' | ')}`);
  lines.push('');
  if (findings.length) {
    lines.push('| ID | Sev | Location | Bug | Test | Status | Fix commit |', '|---|---|---|---|---|---|---|');
    for (const f of findings) lines.push(`| ${cell(f.id)} | ${f.severity} | \`${cell(f.location)}\` | ${cell(f.bug)} | \`${cell(f.test)}\` | open | |`);
    lines.push('', '## Fix Specs');
    for (const f of findings) lines.push(`### ${f.id} (${f.severity}) — \`${f.location}\``, `- Wrong: ${f.bug}`, `- Expected: ${f.expected}`, `- Fix: ${f.fix}`, `- Test: \`${f.test}\``);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(`${outPath}.tmp`, `${lines.join('\n')}\n`);
  fs.renameSync(`${outPath}.tmp`, outPath);

  console.log(`Counts: critical=${counts.critical} high=${counts.high} medium=${counts.medium} low=${counts.low}`);
  console.log(`Summary: ${summary}`);
  console.log(`ReviewFile: ${outPath}`);
  console.log(`GateStatus: ${status}`);
}

await main();
